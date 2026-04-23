const fileInput = document.getElementById("chkFile");
const btnGenerate = document.getElementById("btnGenerate");
const btnDownload = document.getElementById("btnDownload");
const btnClear = document.getElementById("btnClear");
const dataPreview = document.getElementById("dataPreview");
const xmlPreview = document.getElementById("xmlPreview");

let chkText = "";
let parsedData = null;
let generatedXml = "";

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];

  if (!file) return;

  const isChk = file.name.toLowerCase().endsWith(".chk");
  if (!isChk) {
    alert("Por favor selecciona un archivo con extensión .CHK");
    clearAll();
    return;
  }

  chkText = await file.text();
  parsedData = parseChk(chkText);
  renderData(parsedData);
  btnGenerate.disabled = false;
  btnDownload.disabled = true;
  xmlPreview.textContent = "Archivo leído correctamente. Presiona “Generar XML”.";
});

btnGenerate.addEventListener("click", () => {
  if (!parsedData) return;

  generatedXml = buildXml(parsedData);
  xmlPreview.textContent = generatedXml;
  btnDownload.disabled = false;
});

btnDownload.addEventListener("click", () => {
  if (!generatedXml) return;

  const order = parsedData?.orden || "sin_orden";
  const date = parsedData?.fecha || "sin_fecha";
  const filename = `factura_${order}_${date}.xml`;

  const blob = new Blob([generatedXml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  a.remove();
  URL.revokeObjectURL(url);
});

btnClear.addEventListener("click", clearAll);

function parseChk(text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const data = {
    emisorNombre: "",
    emisorRfc: "",
    sucursal: "",
    fecha: "",
    hora: "",
    orden: "",
    modo: "",
    centroIngreso: "",
    turno: "",
    subtotal: "0.00",
    impuesto: "0.00",
    total: "0.00",
    metodoPago: "",
    conceptos: []
  };

  for (const line of lines) {
    const key = line.split(/\s+/)[0];
    const value = line.substring(key.length).trim();

    switch (key) {
      case "HEADER":
        data.sucursal = value;
        break;

      case "FOOTER":
        if (value.toUpperCase().startsWith("RFC:")) {
          data.emisorRfc = value.replace(/RFC:/i, "").trim();
        } else if (!data.emisorNombre) {
          data.emisorNombre = value;
        }
        break;

      case "DATE":
        data.fecha = formatDate(value);
        break;

      case "TIME":
        data.hora = value;
        break;

      case "ORDERNAME":
        data.orden = value.replace(/Order\s*#/i, "").trim();
        break;

      case "ORDERMODE":
        data.modo = value;
        break;

      case "REVENUECENTER":
        data.centroIngreso = value;
        break;

      case "DAYPART":
        data.turno = value;
        break;

      case "ITEM":
        data.conceptos.push(parseItem(value));
        break;

      case "SUBTOTAL":
        data.subtotal = money(value);
        break;

      case "TAX":
        data.impuesto = money(value);
        break;

      case "TOTAL1ITEM":
        data.total = money(value);
        break;

      case "PAYMENT":
        data.metodoPago = value.split(",")[0].trim();
        break;
    }
  }

  if (!data.total || data.total === "0.00") {
    const calculated = Number(data.subtotal) + Number(data.impuesto);
    data.total = money(calculated);
  }

  if (!data.conceptos.length) {
    data.conceptos.push({
      descripcion: "CONCEPTO NO IDENTIFICADO",
      cantidad: "1",
      precioUnitario: data.total,
      importe: data.total
    });
  }

  return data;
}

function parseItem(value) {
  const parts = value.split(",").map(part => part.trim());

  const descripcion = parts[0] || "CONCEPTO";
  const precioUnitario = money(parts[1] || "0");
  const importe = money(parts[2] || precioUnitario);

  return {
    descripcion,
    cantidad: "1",
    precioUnitario,
    importe
  };
}

function buildXml(data) {
  const conceptosXml = data.conceptos.map(concepto => `    <Concepto>
      <Descripcion>${xmlEscape(concepto.descripcion)}</Descripcion>
      <Cantidad>${xmlEscape(concepto.cantidad)}</Cantidad>
      <PrecioUnitario>${xmlEscape(concepto.precioUnitario)}</PrecioUnitario>
      <Importe>${xmlEscape(concepto.importe)}</Importe>
    </Concepto>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Factura>
  <Emisor>
    <Nombre>${xmlEscape(data.emisorNombre)}</Nombre>
    <RFC>${xmlEscape(data.emisorRfc)}</RFC>
    <Sucursal>${xmlEscape(data.sucursal)}</Sucursal>
  </Emisor>
  <Comprobante>
    <Fecha>${xmlEscape(data.fecha)}</Fecha>
    <Hora>${xmlEscape(data.hora)}</Hora>
    <Orden>${xmlEscape(data.orden)}</Orden>
    <Modo>${xmlEscape(data.modo)}</Modo>
    <CentroIngreso>${xmlEscape(data.centroIngreso)}</CentroIngreso>
    <Turno>${xmlEscape(data.turno)}</Turno>
  </Comprobante>
  <Conceptos>
${conceptosXml}
  </Conceptos>
  <Totales>
    <Subtotal>${xmlEscape(data.subtotal)}</Subtotal>
    <Impuesto>${xmlEscape(data.impuesto)}</Impuesto>
    <Total>${xmlEscape(data.total)}</Total>
  </Totales>
  <Pago>
    <Metodo>${xmlEscape(data.metodoPago)}</Metodo>
  </Pago>
</Factura>`;
}

function renderData(data) {
  const rows = [
    ["Emisor", data.emisorNombre],
    ["RFC", data.emisorRfc],
    ["Sucursal", data.sucursal],
    ["Fecha", data.fecha],
    ["Hora", data.hora],
    ["Orden", data.orden],
    ["Modo", data.modo],
    ["Centro ingreso", data.centroIngreso],
    ["Turno", data.turno],
    ["Subtotal", data.subtotal],
    ["Impuesto", data.impuesto],
    ["Total", data.total],
    ["Método pago", data.metodoPago],
    ["Conceptos", data.conceptos.map(c => `${c.descripcion} - $${c.importe}`).join(", ")]
  ];

  dataPreview.innerHTML = rows.map(([label, value]) => `
    <div class="row">
      <strong>${label}</strong>
      <span>${value || "No detectado"}</span>
    </div>
  `).join("");
}

function clearAll() {
  chkText = "";
  parsedData = null;
  generatedXml = "";
  fileInput.value = "";
  btnGenerate.disabled = true;
  btnDownload.disabled = true;
  dataPreview.innerHTML = `<p class="muted">Aún no se ha cargado ningún archivo.</p>`;
  xmlPreview.textContent = "El XML aparecerá aquí...";
}

function formatDate(value) {
  const clean = String(value || "").trim();

  if (/^\d{8}$/.test(clean)) {
    const year = clean.substring(0, 4);
    const month = clean.substring(4, 6);
    const day = clean.substring(6, 8);
    return `${year}-${month}-${day}`;
  }

  return clean;
}

function money(value) {
  const num = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
