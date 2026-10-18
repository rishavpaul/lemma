import fs from 'fs';
export const dur = {};
for (const f of fs.readdirSync('vo')) {
  const b = fs.statSync('vo/' + f).size; dur[f.replace('.wav','')] = (b - 44) / 2 / 24000;
}
