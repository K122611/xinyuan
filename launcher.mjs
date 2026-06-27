import { spawn } from 'child_process';
import { writeFileSync } from 'fs';

const log = [];

function start(name, script, cwd) {
  const child = spawn('node', [script], { cwd, stdio: 'pipe' });
  
  child.stdout.on('data', (data) => {
    const msg = `[${name}] ${data.toString().trim()}`;
    log.push(msg);
  });

  child.stderr.on('data', (data) => {
    const msg = `[${name} ERR] ${data.toString().trim()}`;
    log.push(msg);
  });

  child.on('exit', (code) => {
    const msg = `[${name}] Exited with code ${code}`;
    log.push(msg);
    writeFileSync('C:/Users/LENOVO/Desktop/心元/launcher.txt', log.join('\n'));
  });

  child.on('error', (err) => {
    const msg = `[${name}] Failed: ${err.message}`;
    log.push(msg);
    writeFileSync('C:/Users/LENOVO/Desktop/心元/launcher.txt', log.join('\n'));
  });

  return child;
}

const ota = start('OTA', 'C:/Users/LENOVO/Desktop/心元/start_ota.cjs', 'C:/Users/LENOVO/Desktop/心元');
const bridge = start('Bridge', 'bridge_ai.mjs', 'C:/Users/LENOVO/Desktop/心元/xinyuan-emo-mate');

setInterval(() => {
  writeFileSync('C:/Users/LENOVO/Desktop/心元/launcher.txt', log.join('\n'));
}, 2000);

log.push('Launcher started');
writeFileSync('C:/Users/LENOVO/Desktop/心元/launcher.txt', log.join('\n'));
