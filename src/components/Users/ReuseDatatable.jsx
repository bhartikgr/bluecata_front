import React, { useState, useEffect } from 'react';
import DataTable from 'react-data-table-component';

const ReuseDatatable = ({ title, initialData, nameofreport, dateofreport }) => {
  const [tableData, setTableData] = useState([]);

  useEffect(() => {
    const enrichedData = initialData.map(row => ({ ...row, shared: false }));
    setTableData(enrichedData);
  }, [initialData]);

  const handleCheckboxChange = (id) => {
    const updated = tableData.map(row =>
      row.id === id ? { ...row, shared: !row.shared } : row
    );
    setTableData(updated);
  };

  const columns = [
    { name: 'First Name', selector: row => row.fname, sortable: true },
    { name: 'Last Name', selector: row => row.lname, sortable: true },
    { name: 'Email', selector: row => row.email, sortable: true },
    { name: 'Mobile', selector: row => row.mobile, sortable: true },
    { name: 'Date Viewed', selector: row => row.viewdate, sortable: true },
    {
      name: 'Export List',
      selector: row => (
        <input type="checkbox" checked={!!row.shared} onChange={() => handleCheckboxChange(row.id)} />
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      center: true,
    },
  ];

  const customStyles = {
    headCells: {
      style: {
        fontSize: '14px',
      },
    },
  };

  return (
    <div className='py-2 w-100 border-bottom'>
      <p><strong>{title} : </strong><span>{nameofreport}, {dateofreport}</span> </p>
      <DataTable columns={columns} data={tableData} customStyles={customStyles} />
    </div>
  );
};

export default ReuseDatatable;
