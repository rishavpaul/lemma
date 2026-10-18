import java.io.ByteArrayOutputStream;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.lang.reflect.Array;
import java.lang.reflect.Constructor;
import java.lang.reflect.GenericArrayType;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.lang.reflect.WildcardType;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.*;
import java.util.concurrent.*;

/**
 * Generic judge harness. Usage: Harness <class> <function|design> <cases.json>
 * cases.json: {"method": "...", "inplace": 0, "cases": [{"id": "c1", "input": [...], "timeout_ms": 2000}]}
 *   function: input is the argument list; design: input is [[name, [args...]], ...] with the constructor first.
 * Writes one line per case to the real stdout: @@R@@{"id":..,"status":"ok|error|timeout|skipped","result":..,"ms":..,"stdout":".."}
 */
public class Harness {
    static PrintStream REAL;

    public static void main(String[] a) throws Exception {
        REAL = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        Class<?> clazz;
        try {
            clazz = Class.forName(a[0]);
        } catch (Throwable e) {
            REAL.println("@@FATAL@@" + Json.str("cannot load class " + a[0] + ": " + e));
            REAL.flush();
            Runtime.getRuntime().halt(0);
            return;
        }
        boolean design = a[1].equals("design");
        @SuppressWarnings("unchecked")
        Map<String, Object> spec = (Map<String, Object>) Json.parse(new String(Files.readAllBytes(Paths.get(a[2])), StandardCharsets.UTF_8));
        String method = (String) spec.get("method");
        int inplace = spec.get("inplace") == null ? 0 : ((Number) spec.get("inplace")).intValue();
        @SuppressWarnings("unchecked")
        List<Object> cases = (List<Object>) spec.get("cases");
        ExecutorService pool = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(null, r, "case", 256L << 20);
            t.setDaemon(true);
            return t;
        });
        int timeouts = 0;
        for (Object o : cases) {
            @SuppressWarnings("unchecked")
            Map<String, Object> c = (Map<String, Object>) o;
            String id = (String) c.get("id");
            if (timeouts >= 3) {
                REAL.println("@@R@@{\"id\":" + Json.str(id) + ",\"status\":\"skipped\",\"ms\":0,\"stdout\":\"\"}");
                continue;
            }
            long limit = c.get("timeout_ms") == null ? 2000 : ((Number) c.get("timeout_ms")).longValue();
            Capture cap = new Capture(8192);
            PrintStream ps = new PrintStream(cap, true, "UTF-8");
            System.setOut(ps);
            System.setErr(ps);
            long t0 = System.nanoTime();
            Future<String> f = pool.submit(() -> {
                try {
                    return design ? runDesign(clazz, c.get("input")) : runFunction(clazz, method, inplace, c.get("input"));
                } catch (CaseError e) {
                    throw e;
                } catch (Throwable t) {
                    throw new CaseError(t, null);
                }
            });
            String body;
            try {
                body = "\"status\":\"ok\",\"result\":" + f.get(limit, TimeUnit.MILLISECONDS);
            } catch (TimeoutException e) {
                f.cancel(true);
                timeouts++;
                body = "\"status\":\"timeout\"";
            } catch (ExecutionException e) {
                Throwable cause = e.getCause();
                body = "\"status\":\"error\",\"error\":" + Json.str(describe(cause)) + ",\"trace\":" + Json.str(trace(cause))
                        + (cause instanceof CaseError ce && ce.partial != null ? ",\"partial\":" + ce.partial : "");
            }
            long ms = (System.nanoTime() - t0) / 1_000_000;
            REAL.println("@@R@@{\"id\":" + Json.str(id) + "," + body + ",\"ms\":" + ms + ",\"stdout\":" + Json.str(cap.text()) + "}");
        }
        REAL.println("@@END@@");
        REAL.flush();
        Runtime.getRuntime().halt(0);
    }

    static class CaseError extends RuntimeException {
        final String partial;
        CaseError(Throwable cause, String partial) { super(cause); this.partial = partial; }
    }

    static class Capture extends OutputStream {
        final ByteArrayOutputStream buf = new ByteArrayOutputStream();
        final int cap;
        Capture(int cap) { this.cap = cap; }
        public synchronized void write(int b) { if (buf.size() < cap) buf.write(b); }
        public synchronized void write(byte[] b, int off, int len) { if (buf.size() < cap) buf.write(b, off, Math.min(len, cap - buf.size())); }
        synchronized String text() { return new String(buf.toByteArray(), StandardCharsets.UTF_8); }
    }

    static String describe(Throwable t) {
        if (t instanceof CaseError && t.getCause() != null) t = t.getCause();
        String m = t.getMessage();
        return t.getClass().getName() + (m == null ? "" : ": " + m);
    }

    static String trace(Throwable t) {
        if (t instanceof CaseError && t.getCause() != null) t = t.getCause();
        StringBuilder sb = new StringBuilder();
        int n = 0;
        for (StackTraceElement e : t.getStackTrace()) {
            String cn = e.getClassName();
            if (cn.startsWith("java.") || cn.startsWith("jdk.") || cn.startsWith("sun.") || cn.equals("Harness") || cn.startsWith("Harness$")) continue;
            sb.append("at ").append(e.getClassName()).append('.').append(e.getMethodName()).append(" (line ").append(e.getLineNumber()).append(")\n");
            if (++n >= 6) break;
        }
        return sb.toString();
    }

    // ---- running ------------------------------------------------------------------

    static String runFunction(Class<?> clazz, String method, int inplace, Object input) throws Throwable {
        @SuppressWarnings("unchecked")
        List<Object> args = (List<Object>) input;
        Object inst = clazz.getDeclaredConstructor().newInstance();
        Method m = findMethod(clazz, method, args.size());
        Object[] argv = convertArgs(m.getGenericParameterTypes(), args);
        Object ret;
        try {
            ret = m.invoke(inst, argv);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
        StringBuilder sb = new StringBuilder();
        Json.write(m.getReturnType() == void.class ? argv[inplace] : ret, sb);
        return sb.toString();
    }

    static String runDesign(Class<?> clazz, Object input) throws Throwable {
        @SuppressWarnings("unchecked")
        List<Object> ops = (List<Object>) input;
        StringBuilder out = new StringBuilder("[");
        Object inst = null;
        for (int i = 0; i < ops.size(); i++) {
            @SuppressWarnings("unchecked")
            List<Object> op = (List<Object>) ops.get(i);
            String name = (String) op.get(0);
            @SuppressWarnings("unchecked")
            List<Object> args = op.size() > 1 && op.get(1) != null ? (List<Object>) op.get(1) : new ArrayList<>();
            try {
                if (i == 0) {
                    Constructor<?> k = findCtor(clazz, args.size());
                    inst = k.newInstance(convertArgs(k.getGenericParameterTypes(), args));
                    out.append("null");
                } else {
                    Method m = findMethod(clazz, name, args.size());
                    Object ret;
                    try {
                        ret = m.invoke(inst, convertArgs(m.getGenericParameterTypes(), args));
                    } catch (InvocationTargetException e) {
                        throw e.getCause();
                    }
                    out.append(',');
                    if (m.getReturnType() == void.class) out.append("null");
                    else Json.write(ret, out);
                }
            } catch (Throwable t) {
                out.append(i == 0 ? "" : ",").append("\"<error at op ").append(i).append(": ").append(name).append(">\"]");
                throw new CaseError(t, out.toString());
            }
        }
        return out.append(']').toString();
    }

    static Object[] convertArgs(Type[] types, List<Object> args) throws Exception {
        Object[] argv = new Object[types.length];
        for (int i = 0; i < types.length; i++) argv[i] = Conv.to(args.get(i), types[i]);
        return argv;
    }

    static Method findMethod(Class<?> c, String name, int n) {
        Method best = null;
        for (Class<?> k = c; k != null && k != Object.class; k = k.getSuperclass()) {
            for (Method m : k.getDeclaredMethods()) {
                if (!m.getName().equals(name) || m.getParameterCount() != n || m.isSynthetic() || m.isBridge()) continue;
                if (best == null || (Modifier.isPublic(m.getModifiers()) && !Modifier.isPublic(best.getModifiers()))) best = m;
            }
        }
        if (best == null) throw new IllegalArgumentException("no method " + name + " with " + n + " parameter(s) in " + c.getName());
        best.setAccessible(true);
        return best;
    }

    static Constructor<?> findCtor(Class<?> c, int n) {
        for (Constructor<?> k : c.getDeclaredConstructors()) {
            if (k.getParameterCount() == n) { k.setAccessible(true); return k; }
        }
        throw new IllegalArgumentException("no constructor with " + n + " parameter(s) in " + c.getName());
    }

    // ---- JSON -> Java -----------------------------------------------------------------

    static class Conv {
        static Object natural(Object j) {
            if (j instanceof Long l) return (l >= Integer.MIN_VALUE && l <= Integer.MAX_VALUE) ? (Object) l.intValue() : l;
            if (j instanceof List<?> l) { List<Object> r = new ArrayList<>(); for (Object o : l) r.add(natural(o)); return r; }
            if (j instanceof Map<?, ?> m) { Map<String, Object> r = new LinkedHashMap<>(); for (Map.Entry<?, ?> e : m.entrySet()) r.put((String) e.getKey(), natural(e.getValue())); return r; }
            return j;
        }

        static Object to(Object j, Type t) throws Exception {
            if (t instanceof WildcardType w) return to(j, w.getUpperBounds()[0]);
            if (t instanceof java.lang.reflect.TypeVariable<?>) return natural(j);
            if (t instanceof GenericArrayType g) {
                List<?> l = (List<?>) j;
                Type ct = g.getGenericComponentType();
                Class<?> raw = ct instanceof ParameterizedType p ? (Class<?>) p.getRawType() : Object.class;
                Object arr = Array.newInstance(raw, l.size());
                for (int i = 0; i < l.size(); i++) Array.set(arr, i, to(l.get(i), ct));
                return arr;
            }
            if (t instanceof ParameterizedType p) {
                Class<?> raw = (Class<?>) p.getRawType();
                Type[] ta = p.getActualTypeArguments();
                if (j == null) return null;
                if (Map.class.isAssignableFrom(raw)) {
                    Map<Object, Object> m = SortedMap.class.isAssignableFrom(raw) ? new TreeMap<>() : new LinkedHashMap<>();
                    for (Map.Entry<?, ?> e : ((Map<?, ?>) j).entrySet()) m.put(key((String) e.getKey(), ta[0]), to(e.getValue(), ta[1]));
                    return m;
                }
                if (Collection.class.isAssignableFrom(raw) || raw == Iterable.class) {
                    Collection<Object> c;
                    if (SortedSet.class.isAssignableFrom(raw)) c = new TreeSet<>();
                    else if (Set.class.isAssignableFrom(raw)) c = new LinkedHashSet<>();
                    else if (raw == Deque.class || raw == Queue.class) c = new ArrayDeque<>();
                    else if (raw == LinkedList.class) c = new LinkedList<>();
                    else c = new ArrayList<>();
                    for (Object o : (List<?>) j) c.add(to(o, ta[0]));
                    return c;
                }
                return natural(j);
            }
            Class<?> c = (Class<?>) t;
            if (j == null) {
                if (c.isPrimitive()) throw new IllegalArgumentException("null passed for primitive " + c);
                return null;
            }
            if (c == int.class || c == Integer.class) return ((Number) j).intValue();
            if (c == long.class || c == Long.class) return ((Number) j).longValue();
            if (c == double.class || c == Double.class) return ((Number) j).doubleValue();
            if (c == float.class || c == Float.class) return ((Number) j).floatValue();
            if (c == short.class || c == Short.class) return ((Number) j).shortValue();
            if (c == byte.class || c == Byte.class) return ((Number) j).byteValue();
            if (c == boolean.class || c == Boolean.class) return (Boolean) j;
            if (c == char.class || c == Character.class) return ((String) j).charAt(0);
            if (c == String.class) return (String) j;
            if (c == Object.class) return natural(j);
            if (c == ListNode.class) return listNode((List<?>) j);
            if (c == TreeNode.class) return treeNode((List<?>) j);
            if (c.isArray()) {
                Class<?> ct = c.getComponentType();
                if (ct == char.class && j instanceof String s) return s.toCharArray();
                List<?> l = (List<?>) j;
                Object arr = Array.newInstance(ct, l.size());
                for (int i = 0; i < l.size(); i++) {
                    Object e = l.get(i);
                    if (ct.isArray() && ct.getComponentType() == char.class && e instanceof String s) e = s.toCharArray();
                    Array.set(arr, i, e instanceof char[] ? e : to(e, ct));
                }
                return arr;
            }
            if (Map.class.isAssignableFrom(c) || Collection.class.isAssignableFrom(c)) {
                return to(j, new ParameterizedTypeImpl(c));
            }
            throw new IllegalArgumentException("unsupported parameter type " + c.getName());
        }

        static Object key(String k, Type t) {
            if (t == Integer.class) return Integer.parseInt(k);
            if (t == Long.class) return Long.parseLong(k);
            if (t == Character.class) return k.charAt(0);
            return k;
        }

        static ListNode listNode(List<?> l) {
            ListNode head = new ListNode(), cur = head;
            for (Object o : l) { cur.next = new ListNode(((Number) o).intValue()); cur = cur.next; }
            return head.next;
        }

        static TreeNode treeNode(List<?> l) {
            if (l.isEmpty() || l.get(0) == null) return null;
            TreeNode root = new TreeNode(((Number) l.get(0)).intValue());
            Deque<TreeNode> q = new ArrayDeque<>();
            q.add(root);
            int i = 1;
            while (!q.isEmpty() && i < l.size()) {
                TreeNode n = q.poll();
                if (i < l.size() && l.get(i) != null) { n.left = new TreeNode(((Number) l.get(i)).intValue()); q.add(n.left); }
                i++;
                if (i < l.size() && l.get(i) != null) { n.right = new TreeNode(((Number) l.get(i)).intValue()); q.add(n.right); }
                i++;
            }
            return root;
        }
    }

    /** A raw collection/map class used as a parameter type: elements are converted naturally. */
    static class ParameterizedTypeImpl implements ParameterizedType {
        final Class<?> raw;
        ParameterizedTypeImpl(Class<?> raw) { this.raw = raw; }
        public Type[] getActualTypeArguments() { return Map.class.isAssignableFrom(raw) ? new Type[] {String.class, Object.class} : new Type[] {Object.class}; }
        public Type getRawType() { return raw; }
        public Type getOwnerType() { return null; }
    }

    // ---- JSON text -------------------------------------------------------------------------

    static class Json {
        final String s;
        int i;
        Json(String s) { this.s = s; }

        static Object parse(String s) {
            Json p = new Json(s);
            p.ws();
            Object v = p.value();
            p.ws();
            if (p.i != s.length()) throw new IllegalArgumentException("trailing JSON at " + p.i);
            return v;
        }

        void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

        Object value() {
            char c = s.charAt(i);
            if (c == '{') {
                Map<String, Object> m = new LinkedHashMap<>();
                i++; ws();
                if (s.charAt(i) == '}') { i++; return m; }
                while (true) {
                    ws(); String k = string(); ws(); i++; ws();
                    m.put(k, value()); ws();
                    if (s.charAt(i) == ',') { i++; continue; }
                    i++; return m;
                }
            }
            if (c == '[') {
                List<Object> l = new ArrayList<>();
                i++; ws();
                if (s.charAt(i) == ']') { i++; return l; }
                while (true) {
                    ws(); l.add(value()); ws();
                    if (s.charAt(i) == ',') { i++; continue; }
                    i++; return l;
                }
            }
            if (c == '"') return string();
            if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
            if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
            if (s.startsWith("null", i)) { i += 4; return null; }
            int st = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            String num = s.substring(st, i);
            if (num.isEmpty()) throw new IllegalArgumentException("bad JSON at " + st);
            if (num.indexOf('.') < 0 && num.indexOf('e') < 0 && num.indexOf('E') < 0) {
                try { return Long.parseLong(num); } catch (NumberFormatException e) { return Double.parseDouble(num); }
            }
            return Double.parseDouble(num);
        }

        String string() {
            StringBuilder b = new StringBuilder();
            i++;
            while (true) {
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c == '\\') {
                    char e = s.charAt(i++);
                    switch (e) {
                        case 'n': b.append('\n'); break;
                        case 't': b.append('\t'); break;
                        case 'r': b.append('\r'); break;
                        case 'b': b.append('\b'); break;
                        case 'f': b.append('\f'); break;
                        case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                        default: b.append(e);
                    }
                } else b.append(c);
            }
        }

        static String str(String x) {
            StringBuilder b = new StringBuilder("\"");
            for (int k = 0; k < x.length(); k++) {
                char c = x.charAt(k);
                switch (c) {
                    case '"': b.append("\\\""); break;
                    case '\\': b.append("\\\\"); break;
                    case '\n': b.append("\\n"); break;
                    case '\r': b.append("\\r"); break;
                    case '\t': b.append("\\t"); break;
                    default:
                        if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
                }
            }
            return b.append('"').toString();
        }

        static void write(Object o, StringBuilder sb) {
            if (o == null) { sb.append("null"); return; }
            if (o instanceof Boolean) { sb.append(o); return; }
            if (o instanceof Double || o instanceof Float) {
                double d = ((Number) o).doubleValue();
                if (Double.isNaN(d) || Double.isInfinite(d)) sb.append(str(String.valueOf(d))); else sb.append(d);
                return;
            }
            if (o instanceof Number) { sb.append(o); return; }
            if (o instanceof Character || o instanceof String || o instanceof Enum) { sb.append(str(o.toString())); return; }
            if (o instanceof ListNode n) {
                sb.append('[');
                int count = 0;
                for (ListNode c = n; c != null; c = c.next) {
                    if (count++ > 0) sb.append(',');
                    if (count > 1_000_000) throw new IllegalStateException("linked list too long or has a cycle");
                    sb.append(c.val);
                }
                sb.append(']');
                return;
            }
            if (o instanceof TreeNode t) {
                List<String> out = new ArrayList<>();
                Deque<TreeNode> q = new LinkedList<>();  // holds nulls, which ArrayDeque rejects
                q.add(t);
                while (!q.isEmpty()) {
                    TreeNode n = q.poll();
                    if (n == null) { out.add("null"); continue; }
                    out.add(String.valueOf(n.val));
                    q.add(n.left);
                    q.add(n.right);
                    if (out.size() > 1_000_000) throw new IllegalStateException("tree too large or has a cycle");
                }
                int end = out.size();
                while (end > 0 && out.get(end - 1).equals("null")) end--;
                sb.append('[').append(String.join(",", out.subList(0, end))).append(']');
                return;
            }
            if (o.getClass().isArray()) {
                sb.append('[');
                for (int k = 0, n = Array.getLength(o); k < n; k++) { if (k > 0) sb.append(','); write(Array.get(o, k), sb); }
                sb.append(']');
                return;
            }
            if (o instanceof Iterable<?> it) {
                sb.append('[');
                boolean first = true;
                for (Object e : it) { if (!first) sb.append(','); first = false; write(e, sb); }
                sb.append(']');
                return;
            }
            if (o instanceof Map<?, ?> m) {
                sb.append('{');
                boolean first = true;
                for (Map.Entry<?, ?> e : m.entrySet()) { if (!first) sb.append(','); first = false; sb.append(str(String.valueOf(e.getKey()))).append(':'); write(e.getValue(), sb); }
                sb.append('}');
                return;
            }
            sb.append(str(String.valueOf(o)));
        }
    }
}
