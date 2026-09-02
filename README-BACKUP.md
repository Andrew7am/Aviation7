# Backups

The ledger lives in one hosted database. This makes a second copy on your own
PC, every day, and proves it can be put back.

## Where it goes

```
C:\Users\<you>\Documents\Aviation Backups\
    2026-09-02_1140\
        tickets.json.gz            every row, exactly as stored
        vendor_balances.json.gz
        ... one file per table (23 of them) ...
        Aviation-Backup-2026-09-02.xlsx   the readable version
        manifest.json              row counts, and proof it verified
```

About **6 MB** per run, 30 runs kept — roughly 190 MB of history.

### Putting it somewhere else

Add a line to `.env`:

```
BACKUP_DIR=D:\Backups\Aviation
```

Or pass it per run: `npx tsx scripts/backup-ledger.ts --out="D:\Backups\Aviation"`

**Worth doing:** point it at a OneDrive or Google Drive folder. The copy then
leaves the building on its own, and a backup on the same disk as nothing else
does not survive that disk failing.

## Running it every day

The web app cannot do this. A page in a browser is not allowed to write to a
folder on your PC unattended, and the Vercel deployment has no disk of its own.
It has to run on the machine that keeps the files.

Open **Command Prompt as Administrator** and run:

```
schtasks /create /tn "Aviation Backup" /tr "C:\Aviation\scripts\backup-daily.cmd" /sc daily /st 20:00
```

That runs it at 8pm daily. Useful checks afterwards:

```
schtasks /query /tn "Aviation Backup"     rem is it registered
schtasks /run   /tn "Aviation Backup"     rem run it now
schtasks /delete /tn "Aviation Backup" /f rem remove it
```

Every run appends to `C:\Aviation\backup.log`, including failures — a scheduled
job that fails silently is worse than no scheduled job.

> The PC has to be on at 8pm. If it is often off, add `/sc daily /st 20:00 /ri 60
> /du 24:00` to retry hourly, or pick a time the machine is reliably awake.

## Running it by hand

```
npx tsx scripts/backup-ledger.ts
```

Options: `--out=<folder>` · `--keep=30` (how many to retain) · `--raw` (plain
JSON instead of gzip, for grepping) · `--quiet`.

The script **verifies itself**: after writing, it reads every file back and
checks the row counts against the database. It exits non-zero if anything
disagrees, so a truncated write cannot pass as a good backup.

## Putting a backup back

```
npx tsx scripts/restore-backup.ts                       # newest backup, dry run
npx tsx scripts/restore-backup.ts --from="...\2026-09-02_1140"
npx tsx scripts/restore-backup.ts --tables=tickets      # just one table
```

It shows what it would replace and writes nothing until you add **both** flags:

```
npx tsx scripts/restore-backup.ts --apply --i-know-this-replaces-live-data
```

Everything happens in one transaction — it either all lands or nothing changes.
Tables are filled parents-first using the database's own foreign keys, and the
audit triggers are suspended so the restore does not write thousands of entries
claiming every ticket was deleted.

## Is the backup actually any good?

```
npm run test:backup
```

This copies the newest real backup into throwaway tables and compares **every
column of every row** against the live database, in both directions, then drops
them. It found a real defect the first time it ran: the backup was truncating
microseconds off every timestamp, because Postgres keeps microseconds and a
JavaScript date keeps milliseconds. Timestamps are read as text now.

A backup nobody has ever restored is a guess about the future.
