// pdf-generator.js

window.onload = function () {
  const receiptBtn = document.getElementById("download-receipt");
  if (receiptBtn) {
    receiptBtn.addEventListener("click", () => {
      const invoice = document.getElementById("receipt");
      var opt = {
        margin: 0,
        filename: 'receipt.pdf',
        image: { type: 'jpeg', quality: 1 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
      };
      window.html2pdf().from(invoice).set(opt).save();
    });
  }

  const billBtn = document.getElementById("download-btn");
  if (billBtn) {
    billBtn.addEventListener("click", () => {
      const invoice = document.getElementById("print-content");
      var opt = {
        margin: 0,
        filename: 'bill.pdf',
        image: { type: 'jpeg', quality: 1 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
      };
      window.html2pdf().from(invoice).set(opt).save();
    });
  }
};
