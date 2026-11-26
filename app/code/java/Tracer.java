import com.sun.jdi.*;
import com.sun.jdi.connect.Connector;
import com.sun.jdi.connect.LaunchingConnector;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;

import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Record-and-replay debugger for one test case. Launches the judge harness under the JDK's debugger API (JDI), stops on every
 * line of the candidate's source file and records, per step: the line, the call stack, each user frame's local variables and
 * the objects reachable from them. Also records method return values and exceptions thrown in user code.
 *
 * Usage: Tracer <sourceFile e.g. LRUCache.java> <maxSteps> <java options...> -- <Harness args...>
 * Prints one JSON document on stdout: {"steps": [...], "truncated": bool, "output": "<harness stdout>", "error": null}.
 * The candidate's classes must be compiled with -g so local variable names are available.
 */
public class Tracer {
    static final int MAX_OBJECTS = 60;   // objects captured per step (the heap snapshot)
    static final int MAX_ITEMS = 30;     // elements shown per array or collection
    static final int MAX_FRAMES = 25;    // user frames shown on the call stack
    static final int MAX_STR = 200;

    final String sourceFile;
    final int maxSteps;
    final List<String> steps = new ArrayList<>();
    boolean truncated;
    String lastKey = "";
    String hiddenCtor;  // function problems: the harness's own `new Solution()` is not the candidate's code, so it is not shown

    Tracer(String sourceFile, int maxSteps) { this.sourceFile = sourceFile; this.maxSteps = maxSteps; }

    public static void main(String[] a) throws Exception {
        PrintStream out = new PrintStream(new java.io.FileOutputStream(java.io.FileDescriptor.out), true, "UTF-8");
        int sep = Arrays.asList(a).indexOf("--");
        String options = String.join(" ", Arrays.copyOfRange(a, 2, sep));
        String main = String.join(" ", Arrays.copyOfRange(a, sep + 1, a.length));
        Tracer t = new Tracer(a[0], Integer.parseInt(a[1]));
        if (a.length > sep + 3 && a[sep + 3].equals("function")) t.hiddenCtor = a[sep + 2];
        String error = null;
        StringBuilder output = new StringBuilder();
        try {
            t.run(options, main, output);
        } catch (Throwable e) {
            error = e.toString();
        }
        StringBuilder sb = new StringBuilder("{\"steps\":[");
        for (int i = 0; i < t.steps.size(); i++) { if (i > 0) sb.append(','); sb.append(t.steps.get(i)); }
        sb.append("],\"truncated\":").append(t.truncated).append(",\"output\":").append(q(output.toString()))
          .append(",\"error\":").append(error == null ? "null" : q(error)).append('}');
        out.println(sb);
        out.flush();
        System.exit(0);
    }

    void run(String options, String main, StringBuilder output) throws Exception {
        LaunchingConnector lc = Bootstrap.virtualMachineManager().defaultConnector();
        Map<String, Connector.Argument> args = lc.defaultArguments();
        args.get("options").setValue(options);
        args.get("main").setValue(main);
        VirtualMachine vm = lc.launch(args);
        Thread o1 = drain(vm.process().getInputStream(), output), o2 = drain(vm.process().getErrorStream(), null);
        EventRequestManager erm = vm.eventRequestManager();
        ClassPrepareRequest cpr = erm.createClassPrepareRequest();
        cpr.addSourceNameFilter(sourceFile);
        cpr.setSuspendPolicy(EventRequest.SUSPEND_ALL);
        cpr.enable();
        ExceptionRequest ex = erm.createExceptionRequest(null, true, true);
        ex.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
        ex.enable();
        List<MethodExitRequest> exits = new ArrayList<>();

        EventQueue queue = vm.eventQueue();
        boolean done = false;
        while (!done) {
            // Once the step budget is spent the program runs on unobserved; give it a few seconds to finish (it may loop forever).
            EventSet set = queue.remove(truncated ? 5_000 : 60_000);
            if (set == null) {
                if (!truncated) throw new RuntimeException("the program stopped responding");
                vm.exit(0);
                break;
            }
            for (Event e : set) {
                if (e instanceof VMDeathEvent || e instanceof VMDisconnectEvent) { done = true; break; }
                if (truncated) continue;
                try {
                    if (e instanceof ClassPrepareEvent cp) {
                        ReferenceType rt = cp.referenceType();
                        for (Method m : rt.methods()) {
                            if (m.isAbstract() || m.isNative()) continue;
                            try {
                                for (Location loc : m.allLineLocations()) {
                                    BreakpointRequest br = erm.createBreakpointRequest(loc);
                                    br.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                                    br.enable();
                                }
                            } catch (AbsentInformationException ignored) { }
                        }
                        MethodExitRequest mx = erm.createMethodExitRequest();
                        mx.addClassFilter(rt);
                        mx.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                        mx.enable();
                        exits.add(mx);
                    } else if (e instanceof BreakpointEvent bp) {
                        record(bp.thread(), "line", null, null);
                    } else if (e instanceof MethodExitEvent me) {
                        if (!me.method().isConstructor() && !me.method().isStaticInitializer() && !"void".equals(me.method().returnTypeName())
                                && !me.method().isSynthetic())
                            record(me.thread(), "return", me.method().name(), me.returnValue());
                    } else if (e instanceof ExceptionEvent xe) {
                        if (userFrame(xe.thread()) != null && worthShowing(xe)) record(xe.thread(), "exception", null, xe.exception());
                    }
                } catch (IncompatibleThreadStateException | RuntimeException ignored) { }  // a frame or object went away mid-read
                if (steps.size() >= maxSteps && !truncated) {
                    truncated = true;
                    erm.deleteAllBreakpoints();
                    for (MethodExitRequest mx : exits) mx.disable();
                    ex.disable();
                }
            }
            set.resume();
        }
        o1.join(5000);
        o2.join(5000);
    }

    /** Exceptions the JDK throws and handles internally (class loading and so on) are noise; the candidate's are not. */
    boolean worthShowing(ExceptionEvent xe) {
        Location c = xe.catchLocation();
        if (c == null || isUser(c.declaringType())) return true;
        String n = c.declaringType().name();
        return n.startsWith("Harness") || n.startsWith("java.util.concurrent.") || n.startsWith("jdk.internal.reflect.") || n.startsWith("java.lang.reflect.");
    }

    boolean isUser(ReferenceType t) {
        try { return sourceFile.equals(t.sourceName()); } catch (AbsentInformationException e) { return false; }
    }

    StackFrame userFrame(ThreadReference th) throws IncompatibleThreadStateException {
        for (StackFrame f : th.frames()) if (isUser(f.location().declaringType())) return f;
        return null;
    }

    static boolean expandable(ReferenceType t) {
        String n = t.name();
        return !(n.startsWith("java.") || n.startsWith("javax.") || n.startsWith("jdk.") || n.startsWith("sun.") || n.startsWith("com.sun."));
    }

    // ---- one step --------------------------------------------------------------------------------------------------------

    void record(ThreadReference th, String kind, String method, Value extra) throws IncompatibleThreadStateException {
        List<StackFrame> frames = new ArrayList<>();
        for (StackFrame f : th.frames()) {
            if (isUser(f.location().declaringType())) frames.add(f);
            if (frames.size() >= MAX_FRAMES) break;
        }
        if (frames.isEmpty()) return;
        StackFrame top = frames.get(0);
        Method m = top.location().method();
        if (m.isConstructor() && m.argumentTypeNames().isEmpty() && top.location().declaringType().name().equals(hiddenCtor)) return;
        int line = top.location().lineNumber();
        // One step per line: a line with several bytecode locations (a for loop header) is recorded once per visit.
        ObjectReference self = top.thisObject();
        String key = frames.size() + ":" + top.location().method().name() + ":" + line + ":" + (self == null ? 0 : self.uniqueID());
        if (kind.equals("line") && key.equals(lastKey)) return;
        lastKey = kind.equals("line") ? key : "";

        Heap heap = new Heap();
        StringBuilder sb = new StringBuilder();
        sb.append("{\"kind\":").append(q(kind)).append(",\"line\":").append(line);
        if (method != null) sb.append(",\"method\":").append(q(method));
        if (extra != null || kind.equals("return")) {
            sb.append(",\"value\":");
            if (kind.equals("exception")) sb.append(q(exceptionText((ObjectReference) extra)));
            else heap.enc(extra, sb);
        }
        sb.append(",\"frames\":[");
        for (int i = 0; i < frames.size(); i++) {
            StackFrame f = frames.get(i);
            if (i > 0) sb.append(',');
            Location loc = f.location();
            String cls = simple(loc.declaringType().name());
            String name = loc.method().isConstructor() ? "new " + cls.substring(cls.lastIndexOf('.') + 1) : cls + "." + loc.method().name();
            sb.append("{\"method\":").append(q(name))
              .append(",\"line\":").append(loc.lineNumber()).append(",\"vars\":[");
            boolean first = true;
            if (i < 3) {  // locals for the three innermost frames; deeper frames show only where they are
                ObjectReference me = f.thisObject();
                if (me != null) { sb.append("[\"this\","); heap.enc(me, sb); sb.append(']'); first = false; }
                try {
                    List<LocalVariable> vars = f.visibleVariables();
                    Map<LocalVariable, Value> vals = f.getValues(vars);
                    for (LocalVariable v : vars) {
                        if (!first) sb.append(',');
                        first = false;
                        sb.append('[').append(q(v.name())).append(',');
                        heap.enc(vals.get(v), sb);
                        sb.append(']');
                    }
                } catch (AbsentInformationException ignored) { }
            }
            sb.append("]}");
        }
        sb.append("],\"heap\":");
        heap.fill();
        heap.write(sb);
        sb.append('}');
        steps.add(sb.toString());
    }

    String exceptionText(ObjectReference ex) {
        String msg = null;
        Field f = ex.referenceType().fieldByName("detailMessage");
        if (f != null && ex.getValue(f) instanceof StringReference s) msg = s.value();
        return simple(ex.referenceType().name()) + (msg == null ? "" : ": " + msg);
    }

    // ---- values and the object graph ---------------------------------------------------------------------------------------

    static final Set<String> BOXES = Set.of("java.lang.Integer", "java.lang.Long", "java.lang.Short", "java.lang.Byte", "java.lang.Double",
            "java.lang.Float", "java.lang.Character", "java.lang.Boolean");

    /** Values encode as {"t":"p","v":"3"} (primitive or boxed), {"t":"s","v":"..."} (string), {"t":"n"} (null) or
     *  {"t":"r","id":N,"type":"Node"} (a reference into the step's heap, where the object's contents are). */
    class Heap {
        final LinkedHashMap<Long, ObjectReference> pending = new LinkedHashMap<>();
        final LinkedHashMap<Long, String> done = new LinkedHashMap<>();

        void enc(Value v, StringBuilder sb) {
            if (v == null) { sb.append("{\"t\":\"n\"}"); return; }
            if (v instanceof PrimitiveValue p) { sb.append("{\"t\":\"p\",\"v\":").append(q(prim(p))).append('}'); return; }
            if (v instanceof StringReference s) { sb.append("{\"t\":\"s\",\"v\":").append(q(clip(s.value()))).append('}'); return; }
            if (v instanceof VoidValue) { sb.append("{\"t\":\"n\"}"); return; }
            ObjectReference o = (ObjectReference) v;
            String tn = o.referenceType().name();
            if (BOXES.contains(tn)) {
                Value inner = o.getValue(o.referenceType().fieldByName("value"));
                sb.append("{\"t\":\"p\",\"v\":").append(q(inner instanceof PrimitiveValue p ? prim(p) : "?")).append('}');
                return;
            }
            if (tn.equals("java.lang.StringBuilder") || tn.equals("java.lang.StringBuffer")) {
                sb.append("{\"t\":\"s\",\"v\":").append(q(clip(builderText(o)))).append('}');
                return;
            }
            long id = o.uniqueID();
            if (!done.containsKey(id) && done.size() + pending.size() < MAX_OBJECTS) pending.putIfAbsent(id, o);
            sb.append("{\"t\":\"r\",\"id\":").append(id).append(",\"type\":").append(q(simple(tn))).append('}');
        }

        void fill() {
            while (!pending.isEmpty()) {
                Map.Entry<Long, ObjectReference> e = pending.entrySet().iterator().next();
                pending.remove(e.getKey());
                done.put(e.getKey(), null);  // reserve, so references back to it do not re-queue it
                done.put(e.getKey(), describe(e.getValue()));
            }
        }

        void write(StringBuilder sb) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<Long, String> e : done.entrySet()) {
                if (!first) sb.append(',');
                first = false;
                sb.append('"').append(e.getKey()).append("\":").append(e.getValue());
            }
            sb.append('}');
        }

        String describe(ObjectReference o) {
            StringBuilder sb = new StringBuilder();
            ReferenceType t = o.referenceType();
            String tn = t.name();
            sb.append("{\"type\":").append(q(simple(tn)));
            try {
                if (o instanceof ArrayReference arr) {
                    int n = arr.length();
                    sb.append(",\"k\":\"list\",\"size\":").append(n).append(",\"items\":[");
                    List<Value> vs = n == 0 ? List.of() : arr.getValues(0, Math.min(n, MAX_ITEMS));
                    for (int i = 0; i < vs.size(); i++) { if (i > 0) sb.append(','); enc(vs.get(i), sb); }
                    sb.append(']');
                } else if (expandable(t)) {
                    sb.append(",\"k\":\"obj\",\"fields\":[");
                    List<Field> fs = new ArrayList<>();
                    for (Field f : t.allFields()) if (!f.isStatic() && !f.isSynthetic()) fs.add(f);
                    Map<Field, Value> vals = o.getValues(fs);
                    for (int i = 0; i < fs.size(); i++) {
                        if (i > 0) sb.append(',');
                        sb.append('[').append(q(fs.get(i).name())).append(',');
                        enc(vals.get(fs.get(i)), sb);
                        sb.append(']');
                    }
                    sb.append(']');
                } else if (!collection(o, tn, sb)) {
                    sb.append(",\"k\":\"opaque\"");
                }
            } catch (RuntimeException ex) {
                sb.setLength(0);
                sb.append("{\"type\":").append(q(simple(tn))).append(",\"k\":\"opaque\"");
            }
            return sb.append('}').toString();
        }

        /** The JDK collections people use in interviews, read from their fields (no code runs in the program). */
        boolean collection(ObjectReference o, String tn, StringBuilder sb) {
            switch (tn) {
                case "java.util.HashMap", "java.util.LinkedHashMap" -> {
                    List<Value[]> es = new ArrayList<>();
                    if (tn.equals("java.util.LinkedHashMap")) {
                        for (ObjectReference e = ref(o, "head"); e != null && es.size() < MAX_ITEMS; e = ref(e, "after"))
                            es.add(new Value[]{get(e, "key"), get(e, "value")});
                    } else if (get(o, "table") instanceof ArrayReference table) {
                        for (Value b : table.getValues()) {
                            for (ObjectReference e = (ObjectReference) b; e != null && es.size() < MAX_ITEMS; e = ref(e, "next"))
                                es.add(new Value[]{get(e, "key"), get(e, "value")});
                            if (es.size() >= MAX_ITEMS) break;
                        }
                    }
                    entries(sb, es, intField(o, "size"));
                }
                case "java.util.TreeMap" -> {
                    List<Value[]> es = new ArrayList<>();
                    inorder(ref(o, "root"), es);
                    entries(sb, es, intField(o, "size"));
                }
                case "java.util.HashSet", "java.util.LinkedHashSet", "java.util.TreeSet" -> {
                    ObjectReference m = ref(o, tn.equals("java.util.TreeSet") ? "m" : "map");
                    if (m == null) return false;
                    List<Value[]> es = new ArrayList<>();
                    if (m.referenceType().name().equals("java.util.TreeMap")) inorder(ref(m, "root"), es);
                    else if (m.referenceType().name().equals("java.util.LinkedHashMap")) {
                        for (ObjectReference e = ref(m, "head"); e != null && es.size() < MAX_ITEMS; e = ref(e, "after")) es.add(new Value[]{get(e, "key"), null});
                    } else if (get(m, "table") instanceof ArrayReference table) {
                        for (Value b : table.getValues()) {
                            for (ObjectReference e = (ObjectReference) b; e != null && es.size() < MAX_ITEMS; e = ref(e, "next")) es.add(new Value[]{get(e, "key"), null});
                            if (es.size() >= MAX_ITEMS) break;
                        }
                    }
                    List<Value> keys = new ArrayList<>();
                    for (Value[] kv : es) keys.add(kv[0]);
                    items(sb, "set", keys, intField(m, "size"));
                }
                case "java.util.ArrayList" -> {
                    int n = intField(o, "size");
                    List<Value> vs = new ArrayList<>();
                    if (get(o, "elementData") instanceof ArrayReference data && n > 0) vs.addAll(data.getValues(0, Math.min(n, MAX_ITEMS)));
                    items(sb, "list", vs, n);
                }
                case "java.util.LinkedList" -> {
                    List<Value> vs = new ArrayList<>();
                    for (ObjectReference e = ref(o, "first"); e != null && vs.size() < MAX_ITEMS; e = ref(e, "next")) vs.add(get(e, "item"));
                    items(sb, "list", vs, intField(o, "size"));
                }
                case "java.util.ArrayDeque" -> {
                    if (!(get(o, "elements") instanceof ArrayReference els)) return false;
                    int head = intField(o, "head"), tail = intField(o, "tail"), cap = els.length();
                    int n = cap == 0 ? 0 : ((tail - head) % cap + cap) % cap;
                    List<Value> vs = new ArrayList<>();
                    for (int i = 0; i < Math.min(n, MAX_ITEMS); i++) vs.add(els.getValue((head + i) % cap));
                    items(sb, "list", vs, n);
                }
                case "java.util.PriorityQueue" -> {
                    int n = intField(o, "size");
                    List<Value> vs = new ArrayList<>();
                    if (get(o, "queue") instanceof ArrayReference q && n > 0) vs.addAll(q.getValues(0, Math.min(n, MAX_ITEMS)));
                    items(sb, "heap", vs, n);
                }
                default -> { return false; }
            }
            return true;
        }

        void inorder(ObjectReference node, List<Value[]> out) {
            if (node == null || out.size() >= MAX_ITEMS) return;
            inorder(ref(node, "left"), out);
            if (out.size() < MAX_ITEMS) out.add(new Value[]{get(node, "key"), get(node, "value")});
            inorder(ref(node, "right"), out);
        }

        void entries(StringBuilder sb, List<Value[]> es, int size) {
            sb.append(",\"k\":\"map\",\"size\":").append(size).append(",\"entries\":[");
            for (int i = 0; i < es.size(); i++) {
                if (i > 0) sb.append(',');
                sb.append('[');
                enc(es.get(i)[0], sb);
                sb.append(',');
                enc(es.get(i)[1], sb);
                sb.append(']');
            }
            sb.append(']');
        }

        void items(StringBuilder sb, String k, List<Value> vs, int size) {
            sb.append(",\"k\":").append(q(k)).append(",\"size\":").append(size).append(",\"items\":[");
            for (int i = 0; i < vs.size(); i++) { if (i > 0) sb.append(','); enc(vs.get(i), sb); }
            sb.append(']');
        }
    }

    static Value get(ObjectReference o, String field) {
        Field f = o.referenceType().fieldByName(field);
        return f == null ? null : o.getValue(f);
    }

    static ObjectReference ref(ObjectReference o, String field) {
        return get(o, field) instanceof ObjectReference r ? r : null;
    }

    static int intField(ObjectReference o, String field) {
        return get(o, field) instanceof IntegerValue i ? i.value() : 0;
    }

    static String builderText(ObjectReference o) {
        int count = intField(o, "count");
        if (!(get(o, "value") instanceof ArrayReference arr)) return "";
        boolean latin1 = get(o, "coder") instanceof ByteValue c && c.value() == 0;
        int bytes = Math.min(arr.length(), latin1 ? count : count * 2);
        if (bytes == 0) return "";
        List<Value> vs = arr.getValues(0, Math.min(bytes, MAX_STR * 2));
        byte[] b = new byte[vs.size()];
        for (int i = 0; i < b.length; i++) b[i] = ((ByteValue) vs.get(i)).value();
        return latin1 ? new String(b, StandardCharsets.ISO_8859_1) : new String(b, StandardCharsets.UTF_16LE);
    }

    static String prim(PrimitiveValue p) {
        if (p instanceof CharValue c) return "'" + c.value() + "'";
        return p.toString();
    }

    static String simple(String name) {
        int dot = name.lastIndexOf('.');
        return (dot >= 0 ? name.substring(dot + 1) : name).replace('$', '.');
    }

    static String clip(String s) { return s.length() > MAX_STR ? s.substring(0, MAX_STR) + "…" : s; }

    static Thread drain(InputStream in, StringBuilder into) {
        Thread t = new Thread(() -> {
            try {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) if (into != null) synchronized (into) { into.append(new String(buf, 0, n, StandardCharsets.UTF_8)); }
            } catch (Exception ignored) { }
        });
        t.setDaemon(true);
        t.start();
        return t;
    }

    static String q(String x) {
        StringBuilder b = new StringBuilder("\"");
        for (int k = 0; k < x.length(); k++) {
            char c = x.charAt(k);
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> { if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c); }
            }
        }
        return b.append('"').toString();
    }
}
