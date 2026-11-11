import { openDb, kvGet } from './db';
import { passwordProblem, revokeAll, setPassword } from './auth';
import { readEnv } from './env';

/** Wartungsbefehle: npm run admin:passwd | db:init | db:info | admin:logout-all */
const cmd = process.argv[2];
const cfg = readEnv();

/** Passwort ohne Echo einlesen (oder eine Zeile von stdin, wenn kein Terminal angeschlossen ist). */
function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { stdin.pause(); resolve(buf.slice(0, i).replace(/\r$/, '')); } });
      stdin.on('end', () => resolve(buf.replace(/\r?\n$/, '')));
      return;
    }
    process.stdout.write(prompt);
    let s = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch: string): void => {
      for (const c of ch) {
        if (c === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); reject(new Error('Abgebrochen.')); return; }
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); resolve(s); return; }
        if (c === '\u007f' || c === '\b') s = s.slice(0, -1); else s += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const db = openDb(cfg.dbPath);
  switch (cmd) {
    case 'db:init':
      console.log(`Datenbank bereit: ${cfg.dbPath}`);
      break;
    case 'db:info': {
      const n = (t: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
      console.log(JSON.stringify({ db: cfg.dbPath, passwortGesetzt: !!db.prepare('SELECT 1 FROM admin WHERE id = 1').get(), versionen: n('config_versions'), aktuelleVersion: kvGet(db, 'current_version'), besuche: n('visits'), laeufe: n('runs'), sitzungen: n('sessions') }, null, 2));
      break;
    }
    case 'admin:logout-all':
      revokeAll(db);
      console.log('Alle Sitzungen wurden beendet.');
      break;
    case 'admin:passwd': {
      const exists = !!db.prepare('SELECT 1 FROM admin WHERE id = 1').get();
      const a = await readSecret(exists ? 'Neues Admin-Passwort (mind. 12 Zeichen): ' : 'Admin-Passwort festlegen (mind. 12 Zeichen): ');
      const prob = passwordProblem(a);
      if (prob) throw new Error(prob);
      if (process.stdin.isTTY) { const b = await readSecret('Passwort wiederholen: '); if (a !== b) throw new Error('Die Eingaben stimmen nicht überein.'); }
      setPassword(db, a, Date.now());
      console.log(exists ? 'Passwort geändert. Alle bestehenden Sitzungen wurden beendet.' : 'Passwort gesetzt. Anmeldung unter /admin.');
      break;
    }
    default:
      console.log('Befehle: admin:passwd | db:init | db:info | admin:logout-all   (Umgebung: DB_PATH)');
      process.exitCode = cmd ? 1 : 0;
  }
  db.close();
}

main().catch((e: Error) => { console.error(`Fehler: ${e.message}`); process.exit(1); });
