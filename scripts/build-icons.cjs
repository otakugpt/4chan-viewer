// Resize the approved master and package PNG frames in a Windows ICO container.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sizes = [16, 24, 32, 48, 64, 128, 256];

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 30000,
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

const { app, nativeImage } = require('electron');
const profile = path.join(root, '.test-artifacts', 'icon-build-profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const master = nativeImage.createFromPath(path.join(root, 'assets/branding/rift-crow-master.png'));
  const { width, height } = master.getSize();
  if (master.isEmpty() || width !== height || width < 256) throw new Error('Expected a square master at least 256px wide');
  const output = path.join(root, 'public/icons');
  fs.mkdirSync(output, { recursive: true });
  const frames = sizes.map(size => master.resize({ width: size, height: size, quality: 'best' }).toPNG());
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frames[i].length;
    fs.writeFileSync(path.join(output, `rift-${size}.png`), frames[i]);
  });
  fs.writeFileSync(path.join(output, 'rift.ico'), Buffer.concat([header, ...frames]));
  console.log(`Created RIFT PNG/ICO assets (${sizes.join(', ')}px).`);
  app.exit(0);
}).catch(error => { console.error(error.message); app.exit(1); });
