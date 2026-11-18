// Découpe une liste en lignes de "size" éléments : [1,2,3,4,5] -> [[1,2],[3,4],[5]] (pour une grille).
export function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// Pour comparer sans tenir compte des majuscules ni des accents : "Électro" et "electro" sont identiques.
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
