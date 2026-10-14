import { useState } from 'react';
import type { SavedSearch } from '../lib/types';
import { savedSearches, uid } from '../lib/storage';
import { Badge, Button, EmptyState } from './ui';

export default function SavedSearchesPage({
  onRun,
  onEdit,
}: {
  onRun: (q: SavedSearch['query']) => void;
  onEdit: (q: SavedSearch['query']) => void;
}) {
  const [items, setItems] = useState<SavedSearch[]>(() => savedSearches.list());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Inline actions (window.prompt/confirm are unreliable in embedded webviews).
  function remove(item: SavedSearch) {
    setItems(savedSearches.remove(item.id));
    setConfirmDeleteId(null);
  }

  function rename(item: SavedSearch) {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name || name === item.name) return;
    const updated = { ...item, name, updatedAt: new Date().toISOString() };
    setItems(savedSearches.upsert(updated));
  }

  function duplicate(item: SavedSearch) {
    const copy: SavedSearch = {
      ...item,
      id: uid(),
      name: `${item.name} (copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setItems(savedSearches.upsert(copy));
  }

  if (!items.length) {
    return (
      <div className="p-6">
        <h2 className="mb-4 text-xl font-bold">Saved Searches</h2>
        <EmptyState
          title="No saved searches yet"
          hint="Configure filters on the Jobs page and press “Save search”. Saved searches store keywords, location, radius, remote preference, sources, job type, posting age and results-per-source — and survive browser restarts."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <h2 className="text-xl font-bold">Saved Searches <span className="text-sm font-normal text-slate-400">({items.length})</span></h2>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold">{item.name}</div>
                <div className="mt-0.5 text-xs text-slate-500">updated {new Date(item.updatedAt).toLocaleString()}</div>
              </div>
              <Button onClick={() => onRun(item.query)}>Run now</Button>
            </div>            <div className="mt-2 flex flex-wrap gap-1 text-xs">
              {item.query.terms.filter(Boolean).map((t) => <Badge key={t} tone="blue">“{t}”</Badge>)}
              {item.query.location && <Badge>📍 {item.query.location}{item.query.distance ? ` +${item.query.distance}mi` : ''}</Badge>}
              {item.query.isRemote && <Badge tone="violet">Remote</Badge>}
              {item.query.jobType && <Badge>{item.query.jobType}</Badge>}
              {item.query.hoursOld && <Badge>{item.query.hoursOld}h</Badge>}
              <Badge tone="green">{item.query.sources.length} sources</Badge>
              <Badge>{item.query.resultsWanted}/source</Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <Button variant="secondary" onClick={() => onEdit(item.query)}>Edit in search form</Button>
              {renamingId === item.id ? (
                <>
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(item);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    className="w-44 rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                  <Button onClick={() => rename(item)} disabled={!renameValue.trim()}>Save</Button>
                  <Button variant="secondary" onClick={() => setRenamingId(null)}>Cancel</Button>
                </>
              ) : (
                <Button variant="secondary" onClick={() => { setRenamingId(item.id); setRenameValue(item.name); }}>Rename</Button>
              )}
              <Button variant="secondary" onClick={() => duplicate(item)}>Duplicate</Button>
              {confirmDeleteId === item.id ? (
                <>
                  <span className="text-xs text-slate-500">Delete?</span>
                  <Button variant="danger" onClick={() => remove(item)}>Yes, delete</Button>
                  <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>Keep</Button>
                </>
              ) : (
                <Button variant="danger" onClick={() => setConfirmDeleteId(item.id)}>Delete</Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
