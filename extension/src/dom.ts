export const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.querySelector<T>(`#${id}`);
  if (!node) throw new Error(`Missing #${id} in the page.`);
  return node;
};
