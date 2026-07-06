export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);

  return rows;
};

export const makeUniqueHeaders = (headers) => {
  const counts = {};

  return headers.map((header, index) => {
    const cleanHeader = header.trim() || `Kolumna_${index + 1}`;
    counts[cleanHeader] = (counts[cleanHeader] ?? 0) + 1;

    return counts[cleanHeader] === 1
      ? cleanHeader
      : `${cleanHeader}_${counts[cleanHeader]}`;
  });
};

export const csvToObjects = (text) => {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const headers = makeUniqueHeaders(rows[0]);

  return rows.slice(1).map((values) => {
    const row = {};

    headers.forEach((header, index) => {
      const value = values[index] ?? '';
      if (value !== '') row[header] = value;
    });

    return row;
  }).filter((row) => Object.keys(row).length > 0);
};
