const PDFDocument = require('pdfkit');

function generateInvoicePDF(invoice, res) {
  const doc = new PDFDocument({
    margin: 50,
    size: 'A4'
  });

  const safeNumber = String(invoice.number || 'invoice')
    .replace(/[^a-zA-Z0-9_-]/g, '_');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeNumber}.pdf"`
  );

  doc.pipe(res);

  const currency = invoice.currency || 'INR';

  const money = value =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency
    }).format(Number(value) || 0);

  // Header
  doc.fontSize(25)
    .font('Helvetica-Bold')
    .text('BRIGHTLOOP', { align: 'center' });

  doc.fontSize(10)
    .font('Helvetica')
    .text('SUBSCRIPTION MANAGEMENT', { align: 'center' });

  doc.moveDown(2);

  doc.fontSize(20)
    .font('Helvetica-Bold')
    .text('INVOICE');

  doc.moveDown();

  // Invoice details
  doc.fontSize(11).font('Helvetica');

  doc.text(`Invoice Number: ${invoice.number || 'N/A'}`);
  doc.text(`Customer: ${invoice.customer_name || 'N/A'}`);
  doc.text(`Email: ${invoice.customer_email || 'N/A'}`);
  doc.text(`Issue Date: ${invoice.issue_date || 'N/A'}`);
  doc.text(`Due Date: ${invoice.due_date || 'N/A'}`);
  doc.text(`Status: ${invoice.status || 'N/A'}`);

  doc.moveDown(2);

  // Line items
  doc.fontSize(13)
    .font('Helvetica-Bold')
    .text('INVOICE ITEMS');

  doc.moveDown();

  doc.fontSize(10).font('Helvetica');

  (invoice.line_items || []).forEach((item, index) => {
    doc.text(
      `${index + 1}. ${item.description || item.line_type || 'Item'}`
    );

    doc.text(money(item.amount), { align: 'right' });
  });

  doc.moveDown(2);

  // Financial summary
  doc.fontSize(12)
    .font('Helvetica-Bold')
    .text('PAYMENT SUMMARY');

  doc.moveDown();

  doc.fontSize(11).font('Helvetica');

  doc.text(`Subtotal: ${money(invoice.subtotal)}`);
  doc.text(`Tax: ${money(invoice.tax_total)}`);
  doc.text(`Discount: ${money(invoice.discount_total)}`);

  doc.moveDown();

  doc.fontSize(14)
    .font('Helvetica-Bold')
    .text(`Total: ${money(invoice.total_amount)}`);

  doc.fontSize(11)
    .font('Helvetica')
    .text(`Paid: ${money(invoice.paid_amount)}`);

  doc.text(`Outstanding: ${money(invoice.balance)}`);

  doc.moveDown(3);

  doc.fontSize(9)
    .text('Thank you for your business.', {
      align: 'center'
    });

  doc.end();
}

module.exports = { generateInvoicePDF };
