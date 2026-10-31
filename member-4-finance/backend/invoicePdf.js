const PDFDocument = require('pdfkit');

function generateInvoicePDF(invoice, res) {
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${invoice.number || 'invoice'}.pdf"`
  );

  doc.pipe(res);

  // Header
  doc.fontSize(24).text('BRIGHTLOOP', { align: 'center' });
  doc.fontSize(11).text('SUBSCRIPTION MANAGEMENT', { align: 'center' });

  doc.moveDown(2);

  // Invoice details
  doc.fontSize(20).text('INVOICE');
  doc.moveDown();

  doc.fontSize(11);
  doc.text(`Invoice Number: ${invoice.number || 'N/A'}`);
  doc.text(`Customer: ${invoice.customer_name || 'N/A'}`);
  doc.text(`Issue Date: ${invoice.issue_date || 'N/A'}`);
  doc.text(`Due Date: ${invoice.due_date || 'N/A'}`);

  doc.moveDown(2);

  // Amount summary
  doc.fontSize(13).text('PAYMENT SUMMARY');
  doc.moveDown();

  doc.fontSize(11);
  doc.text(`Subtotal: ${invoice.subtotal || 0}`);
  doc.text(`Tax: ${invoice.tax_total || 0}`);
  doc.text(`Discount: ${invoice.discount_total || 0}`);
  doc.moveDown();

  doc.fontSize(16).text(
    `Total Amount: ${invoice.total_amount || invoice.total || 0}`,
    { underline: true }
  );

  doc.moveDown();
  doc.fontSize(11).text(`Status: ${invoice.status || 'N/A'}`);

  doc.moveDown(3);
  doc.fontSize(9).text('Thank you for your business.', {
    align: 'center'
  });

  doc.end();
}

module.exports = { generateInvoicePDF };
