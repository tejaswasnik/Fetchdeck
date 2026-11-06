import { useState } from 'react';
import { AddUrlDialog } from './components/AddUrlDialog';
import { DownloadList } from './components/DownloadList';
import { useDownloads } from './useDownloads';

export const App = () => {
  const { downloads, actions } = useDownloads();
  const [adding, setAdding] = useState(false);

  return (
    <main className="app">
      <header className="app__header">
        <h1>Fetchdeck</h1>
        <button className="primary" onClick={() => setAdding(true)}>Add link</button>
      </header>
      <DownloadList
        downloads={downloads}
        onPause={(id) => void actions.pause(id)}
        onResume={(id) => void actions.resume(id)}
        onCancel={(id) => void actions.cancel(id)}
        onRemove={(id) => void actions.remove(id)}
      />
      {adding && <AddUrlDialog onAdd={actions.add} onClose={() => setAdding(false)} />}
    </main>
  );
};
