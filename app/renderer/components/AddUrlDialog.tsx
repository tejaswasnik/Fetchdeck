import { useState, type FormEvent } from 'react';

type AddUrlDialogProps = {
  onAdd: (url: string) => void | Promise<void>;
  onClose: () => void;
};

export const AddUrlDialog = ({ onAdd, onClose }: AddUrlDialogProps) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const url = value.trim();
    if (url === '') {
      setError('Paste a link first');
      return;
    }
    try {
      await onAdd(url);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that link');
    }
  };

  return (
    <div className="overlay">
      <form className="dialog" onSubmit={submit} aria-label="Add download">
        <h2>Add a download</h2>
        <label>
          Link
          <input
            autoFocus
            value={value}
            placeholder="https://example.com/file.zip"
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error && <p className="row__error" role="alert">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Add</button>
        </div>
      </form>
    </div>
  );
};
