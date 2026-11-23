import React from "react";
import DataTable from "./DataTable.jsx";

export default function RegisterTable({ data, keyField, columns, renderFromRow = false }) {
  return (
    <DataTable
      rows={data}
      columns={columns.map(column => column.title || column.label)}
      renderRow={row => (
        <tr key={row[keyField]}>
          {columns.map(column => {
            const value = row[column.key];
            return (
              <td key={column.key} className="px-6 py-3">
                {column.render ? column.render(renderFromRow ? row : value, row) : value ?? "—"}
              </td>
            );
          })}
        </tr>
      )}
    />
  );
}
