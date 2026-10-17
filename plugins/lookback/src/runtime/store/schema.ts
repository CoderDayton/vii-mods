import type { Database } from 'bun:sqlite'

import { floatsToBytes } from './vectors'

// Bump when a table below changes shape or what a column holds, with a step in MIGRATIONS.
export const SCHEMA_VERSION = '14'

export const searchedText = (row: string): string => `case when ${row}.kind = 'image' then substr(${row}.text, instr(${row}.text, char(10)) + 1) else ${row}.text end`

const searchCaptionsOnly = (db: Database): void => {
  db.exec('drop trigger if exists entries_fts_insert; drop trigger if exists entries_fts_delete')
  db.exec(`insert into entries_fts (entries_fts, rowid, text) select 'delete', id, text from entries where kind = 'image'`)
  db.exec(`insert into entries_fts (rowid, text) select id, ${searchedText('entries')} from entries where kind = 'image'`)
  db.exec("delete from chunks where entry in (select id from entries where kind = 'image')")
}

// `reread` makes the next index run read every transcript again, for a step after which more is read from them.
export type Migration = { change: string | ((db: Database) => void); reread: boolean }

// What brings an index of each older version one version up, before SCHEMA runs. Claude Code deletes old
// transcripts, so an index holds sessions that cannot be read again: a step keeps them. An index of a version
// with no step here is emptied and rebuilt from the transcripts still on disk.
export const MIGRATIONS: Readonly<Record<string, Migration>> = {
  '8': { change: "alter table entries add column key text not null default ''", reread: true },
  '9': { change: floatsToBytes, reread: false },
  '10': { change: "alter table files add column calls text not null default '{}'", reread: false },
  // The image tables are new and SCHEMA makes them.
  '11': { change: 'select 1', reread: false },
  '12': { change: searchCaptionsOnly, reread: false },
  '13': { change: 'drop index if exists entries_session', reread: false },
}

// Stems words ("fixing" finds "fixed") and splits on punctuation, so a path or a dotted name is a phrase.
const TOKENIZER = 'porter unicode61'

// The tables a rebuild drops. `forgotten` is not one: it is the user's word, not read from the transcripts,
// so a new shape for it needs a migration. Nor is `images`, whose captions took a model to write.
export const TABLES = ['chunks', 'entries_fts', 'entries', 'touches', 'titles', 'files', 'pastes', 'meta'] as const

export const SCHEMA = `
  create table if not exists meta (
    key text primary key,
    value text not null
  ) without rowid;

  create table if not exists files (
    path text primary key,
    size integer not null,
    offset integer not null,
    calls text not null default '{}'
  ) without rowid;

  create table if not exists forgotten (
    session text primary key,
    project text not null,
    at integer not null,
    sources text not null
  ) without rowid;

  create table if not exists entries (
    id integer primary key,
    source text not null,
    session text not null,
    parent text not null default '',
    project text not null,
    kind text not null,
    ts integer not null,
    text text not null,
    key text not null default ''
  );
  create unique index if not exists entries_key on entries (key) where key <> '';
  create index if not exists entries_session_kind on entries (session, kind, ts);
  create index if not exists entries_project on entries (project, session, ts) where parent = '';
  create index if not exists entries_source on entries (source);
  create index if not exists entries_parent on entries (parent) where parent <> '';
  -- Counts entries of a kind without reading their text: each prompt's recall counts them.
  create index if not exists entries_kind on entries (kind);

  create virtual table if not exists entries_fts using fts5 (
    text,
    content = 'entries',
    content_rowid = 'id',
    tokenize = '${TOKENIZER}'
  );
  create trigger if not exists entries_fts_insert after insert on entries begin
    insert into entries_fts (rowid, text) values (new.id, ${searchedText('new')});
  end;
  -- New ids follow the largest left, so the watermark of settled entries must not pass it.
  create trigger if not exists entries_settled_delete after delete on entries begin
    update meta set value = (select coalesce(max(id), 0) from entries)
    where key = 'settled' and cast(value as integer) > (select coalesce(max(id), 0) from entries);
  end;
  create trigger if not exists entries_fts_delete after delete on entries begin
    insert into entries_fts (entries_fts, rowid, text) values ('delete', old.id, ${searchedText('old')});
  end;

  create table if not exists titles (
    session text primary key,
    title text not null,
    custom integer not null
  ) without rowid;

  create table if not exists touches (
    id integer primary key,
    source text not null,
    session text not null,
    parent text not null default '',
    project text not null,
    ts integer not null,
    path text not null,
    action text not null,
    tool text not null
  );
  create index if not exists touches_path on touches (path);
  create index if not exists touches_session on touches (session);
  create index if not exists touches_source on touches (source);

  create table if not exists images (
    sha text primary key,
    file text not null,
    caption text,
    tries integer not null default 0
  ) without rowid;

  create table if not exists pastes (
    key text primary key,
    sha text not null,
    source text not null,
    session text not null,
    parent text not null default '',
    project text not null,
    ts integer not null
  ) without rowid;
  create index if not exists pastes_sha on pastes (sha);

  create table if not exists chunks (
    id integer primary key,
    entry integer not null references entries (id) on delete cascade,
    seq integer not null,
    embedding blob not null,
    unique (entry, seq)
  );
`
