import * as XLSX from 'xlsx';
import type { StudentResult } from '../types';

function buildRows(results: StudentResult[]) {
  const maxQ = Math.max(...results.map((r) => r.grade_data.total_questions), 0);

  const headers = [
    '生徒名',
    ...Array.from({ length: maxQ }, (_, i) => `問${i + 1}`),
    '合計点',
    '正答率(%)',
    '採点日時',
  ];

  const rows = results.map((result) => {
    const cells = Array.from({ length: maxQ }, (_, i) => {
      const q = result.grade_data.questions[i];
      return q ? (q.is_correct ? '○' : '×') : '-';
    });
    const { total_correct: c, total_questions: t } = result.grade_data;
    const rate = t > 0 ? Math.round((c / t) * 100) : 0;
    return [
      result.student_name,
      ...cells,
      `${c}/${t}`,
      rate,
      new Date(result.graded_at).toLocaleString('ja-JP'),
    ];
  });

  return { headers, rows, maxQ };
}

export function exportToExcel(results: StudentResult[]): void {
  if (results.length === 0) return;
  const { headers, rows, maxQ } = buildRows(results);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    { wch: 14 },
    ...Array.from({ length: maxQ }, () => ({ wch: 6 })),
    { wch: 8 },
    { wch: 10 },
    { wch: 20 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '採点結果');
  const dateStr = new Date().toLocaleDateString('ja-JP').replace(/\//g, '-');
  XLSX.writeFile(wb, `採点結果_${dateStr}.xlsx`);
}

export function exportToCSV(results: StudentResult[]): void {
  if (results.length === 0) return;
  const { headers, rows } = buildRows(results);

  const csv = [headers, ...rows]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toLocaleDateString('ja-JP').replace(/\//g, '-');
  a.download = `採点結果_${dateStr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
