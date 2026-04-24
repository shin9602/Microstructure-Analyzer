import React from 'react';
import type { FileResult } from '../types';
import { Download, RefreshCw, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ResultsTableProps {
  results: FileResult[];
  onReset: () => void;
}

const ResultsTable: React.FC<ResultsTableProps> = ({ results, onReset }) => {

  const downloadExcel = () => {
    if (results.length === 0) return;

    const wb = XLSX.utils.book_new();

    // Create a summary sheet
    const summaryData = [['Microstructure Analysis Results'], ['']];
    summaryData.push(['File Name', 'Peak', 'Measured Intensity', 'Rel. Intensity (%)', 'Reference Intensity', 'TC']);

    results.forEach(fileRes => {
      const maxIntensity = Math.max(...fileRes.results.map(r => r.rawIntensity), 0);
      fileRes.results.forEach((r, idx) => {
        const relIntensity = maxIntensity > 0 ? (r.rawIntensity / maxIntensity) * 100 : 0;
        summaryData.push([
          idx === 0 ? fileRes.fileName : '',
          r.plane,
          r.rawIntensity.toFixed(2),
          relIntensity.toFixed(2) + '%',
          r.referenceIntensity.toString(),
          isNaN(r.tc) ? '-' : r.tc.toFixed(2)
        ]);
      });
      summaryData.push(['']); // Empty row between files
    });

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // Create individual sheets for each file
    results.forEach((fileRes, index) => {
      const maxIntensity = Math.max(...fileRes.results.map(r => r.rawIntensity), 0);
      const wsData = [
        [fileRes.fileName],
        [''],
        ['Peak', 'Measured Intensity', 'Rel. Intensity (%)', 'Reference Intensity', 'TC']
      ];

      fileRes.results.forEach(r => {
        const relIntensity = maxIntensity > 0 ? (r.rawIntensity / maxIntensity) * 100 : 0;
        wsData.push([
          r.plane,
          r.rawIntensity.toFixed(2),
          relIntensity.toFixed(2) + '%',
          r.referenceIntensity.toString(),
          isNaN(r.tc) ? '-' : r.tc.toFixed(2)
        ]);
      });

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const sheetName = `File_${index + 1}`.slice(0, 31); // Excel sheet name limit
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    const date = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `results_${date}.xlsx`);
  };

  if (results.length === 0) return null;

  const planes = results[0].results.map(r => r.plane);

  return (
    <div className="w-full animate-fade-in">
      <div className="flex justify-between items-end mb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Analysis Results</h2>
          <p className="text-slate-500">Compare Intensity and Texture Coefficients.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onReset}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw size={16} />
            New Analysis
          </button>
          <button
            onClick={downloadExcel}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 shadow-sm transition-all"
          >
            <FileSpreadsheet size={16} />
            Export Excel
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
        <table className="w-full text-left text-sm text-slate-600 whitespace-nowrap">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-semibold">
            <tr>
              <th className="px-6 py-4 border-b border-slate-200 min-w-[200px]">
                FILE NAME
              </th>
              <th className="px-4 py-4 border-b border-slate-200 w-24 text-center">
                METRIC
              </th>
              {planes.map(plane => (
                <th key={plane} className="px-4 py-4 border-b border-slate-200 text-center min-w-[100px]">
                  {plane}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {results.map((fileRes, idx) => {
              const maxIntensity = Math.max(...fileRes.results.map(r => r.rawIntensity), 0);

              return (
                <React.Fragment key={fileRes.fileId}>
                  {/* Intensity Row */}
                  <tr className="bg-white hover:bg-slate-50 transition-colors group">
                    <td
                      rowSpan={3}
                      className="px-6 py-4 font-medium text-slate-900 border-r border-slate-100 align-middle bg-white group-hover:bg-slate-50"
                    >
                      <div className="max-w-[200px] truncate" title={fileRes.fileName}>
                        {fileRes.fileName}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wider border-r border-dashed border-slate-100">
                      INTENSITY
                    </td>
                    {fileRes.results.map(r => (
                      <td
                        key={`int-${r.plane}`}
                        className={`px-4 py-3 text-center font-mono border-r border-dashed border-slate-100 last:border-r-0 ${r.isNearBoundary ? 'bg-yellow-50 text-yellow-800' : 'text-slate-600'}`}
                        title={r.isNearBoundary ? `Peak at ${r.peakTwoTheta.toFixed(3)}° is near range boundary — consider expanding the range` : undefined}
                      >
                        {r.isNearBoundary && <span className="mr-1">⚠</span>}
                        {r.rawIntensity.toFixed(2)}
                      </td>
                    ))}
                  </tr>

                  {/* Relative Intensity Row */}
                  <tr className="bg-slate-50/50 hover:bg-slate-100 transition-colors">
                    <td className="px-4 py-3 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider border-r border-dashed border-slate-100 leading-tight">
                      REL. INTENSITY<br />(%)</td>
                    {fileRes.results.map(r => {
                      const relIntensity = maxIntensity > 0 ? (r.rawIntensity / maxIntensity) * 100 : 0;
                      return (
                        <td key={`rel-${r.plane}`} className="px-4 py-3 text-center text-slate-500 font-mono border-r border-dashed border-slate-100 last:border-r-0">
                          {relIntensity.toFixed(2)}%
                        </td>
                      );
                    })}
                  </tr>

                  {/* TC Row */}
                  <tr className="bg-blue-50/30 hover:bg-blue-50 transition-colors">
                    <td className="px-4 py-3 text-center text-xs font-bold text-blue-500 uppercase tracking-wider border-r border-dashed border-blue-100">
                      TC
                    </td>
                    {fileRes.results.map(r => (
                      <td key={`tc-${r.plane}`} className="px-4 py-3 text-center text-blue-700 font-bold font-mono border-r border-dashed border-blue-100 last:border-r-0">
                        {isNaN(r.tc) ? '-' : r.tc.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default React.memo(ResultsTable);