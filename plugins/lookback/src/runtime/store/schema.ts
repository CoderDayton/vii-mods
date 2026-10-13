// Bump when a table below changes shape, and add the step from the version before to MIGRATIONS.
export const SCHEMA_VERSION = '9'

// What brings an index of each older version one version up, before SCHEMA runs. Claude Code deletes old
// transcripts, so an index holds sessions that cannot be read again: a step keeps them. An index of a version
// with no step here is emptied and rebuilt from the transcripts still on disk.
export const MIGRATIONS: Readonly<Record<string, string>> = {
  '8': "alter table entries add column key text not null default ''",
}

// Stems words ("fixing" finds "fixed") and splits on punctuation, so a path or a dotted name is a phrase.
const TOKENIZER = 'porter unicode61'

// The tables a rebuild drops. `forgotten` is not one: it is the user's word, not read from the transcripts,
// so a new shape for it needs a migration.
export const TABLES = ['chunks', 'entries_fts', 'entries', 'touches', 'titles', 'files', 'meta'] as const

export const SCHEMA = `
  create table if not exists meta (
    key text primary key,
    value text not null
  ) without rowid;

  create table if not exists files (
    path text primary key,
    size integer not null,
    offset integer not null
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
  create index if not exists entries_session on entries (session);
  create index if not exists entries_source on entries (source);
  create index if not exists entries_parent on entries (parent) where parent <> '';

  create virtual table if not exists entries_fts using fts5 (
    text,
    content = 'entries',
    content_rowid = 'id',
    tokenize = '${TOKENIZER}'
  );
  create trigger if not exists entries_fts_insert after insert on entries begin
    insert into entries_fts (rowid, text) values (new.id, new.text);
  end;
  create trigger if not exists entries_fts_delete after delete on entries begin
    insert into entries_fts (entries_fts, rowid, text) values ('delete', old.id, old.text);
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

  create table if not exists chunks (
    id integer primary key,
    entry integer not null references entries (id) on delete cascade,
    seq integer not null,
    embedding blob not null,
    unique (entry, seq)
  );
`
