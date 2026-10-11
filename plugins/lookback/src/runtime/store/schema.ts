// Bump when a table below changes shape. An index written under another version is rebuilt from the transcripts.
export const SCHEMA_VERSION = '2'

// Stems words ("fixing" finds "fixed") and splits on punctuation, so a path or a dotted name is a phrase.
const TOKENIZER = 'porter unicode61'

export const TABLES = ['chunks', 'entries_fts', 'entries', 'files', 'meta'] as const

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

  create table if not exists entries (
    id integer primary key,
    source text not null,
    session text not null,
    project text not null,
    kind text not null,
    ts integer not null,
    text text not null
  );
  create index if not exists entries_session on entries (session);
  create index if not exists entries_source on entries (source);

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

  create table if not exists chunks (
    id integer primary key,
    entry integer not null references entries (id) on delete cascade,
    seq integer not null,
    embedding blob not null,
    unique (entry, seq)
  );
`
