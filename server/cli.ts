import { hashPassword } from './crypto';
import { passwordProblem, setPassword, revokeAll } from './auth';
import { ensureSchema } from './db';
import { readEnv } from './env';
import { sqliteDb } from './sqlite';

/**
 * Befehle:
 *  admin:hash    Passwort verdeckt eingeben → PBKDF2-Hash ausgeben (als Secret ADMIN_PASSWORD_HASH in Cloudflare eintragen)
 *  admin:passwd  Passwort in der LOKALEN Datenbank setzen (nur Entwicklung/Abnahme; DB_PATH)
 *  db:info       Stand der lokalen Datenbank
 */
const cmd = process.argv[2];
const cfg = readEnv();

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
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
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

async function newPassword(): Promise<string> {
  const a = await readSecret('Admin-Passwort festlegen (mind. 12 Zeichen): ');
  const prob = passwordProblem(a);
  if (prob) throw new Error(prob);
  if (process.stdin.isTTY && a !== (await readSecret('Passwort wiederholen: '))) throw new Error('Die Eingaben stimmen nicht überein.');
  return a;
}

async function main(): Promise<void> {
  switch (cmd) {
    case 'admin:hash': {
      const h = await hashPassword(await newPassword());
      console.log('\nIn Cloudflare Pages unter Einstellungen → Variablen und Secrets als Secret „ADMIN_PASSWORD_HASH“ eintragen:\n');
      console.log(h + '\n');
      break;
    }
    case 'admin:passwd': {
      const db = sqliteDb(cfg.dbPath);
      await ensureSchema(db, db);
      await setPassword(db, cfg.app.ADMIN_PASSWORD_HASH, await newPassword(), Date.now());
      console.log('Passwort in der lokalen Datenbank gesetzt (alle Sitzungen beendet).');
      db.close();
      break;
    }
    case 'admin:logout-all': {
      const db = sqliteDb(cfg.dbPath); await ensureSchema(db, db); await revokeAll(db); console.log('Alle lokalen Sitzungen beendet.'); db.close();
      break;
    }
    case 'db:info': {
      const db = sqliteDb(cfg.dbPath); await ensureSchema(db, db);
      const n = async (t: string): Promise<number> => (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))!.n;
      console.log(JSON.stringify({ db: cfg.dbPath, versionen: await n('config_versions'), besuche: await n('visits'), laeufe: await n('runs'), sitzungen: await n('sessions') }, null, 2));
      db.close();
      break;
    }
    default:
      console.log('Befehle: admin:hash | admin:passwd | admin:logout-all | db:info');
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e: Error) => { console.error(`Fehler: ${e.message}`); process.exit(1); });
