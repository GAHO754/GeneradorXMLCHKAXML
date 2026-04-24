const fileInput = document.getElementById("chkFile");
const btnGenerate = document.getElementById("btnGenerate");
const btnDownload = document.getElementById("btnDownload");
const btnClear = document.getElementById("btnClear");
const dataPreview = document.getElementById("dataPreview");
const validationPreview = document.getElementById("validationPreview");
const xmlPreview = document.getElementById("xmlPreview");
const statusBox = document.getElementById("statusBox");

let parsedData = null;
let generatedXml = "";

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".chk")) {
    showStatus("error", "El archivo debe tener extensión .CHK");
    clearAll(false);
    return;
  }

  const chkText = await file.text();
  parsedData = parseChk(chkText);

  renderData(parsedData);
  renderValidations(validateData(parsedData));

  btnGenerate.disabled = false;
  btnDownload.disabled = true;
  generatedXml = "";
  xmlPreview.textContent = "Archivo leído correctamente. Presiona “Validar y generar XML”.";
  showStatus("success", "Archivo .CHK cargado correctamente.");
});

btnGenerate.addEventListener("click", () => {
  if (!parsedData) return;

  const validations = validateData(parsedData);
  renderValidations(validations);

  const errors = validations.filter(v => v.type === "error");

  if (errors.length > 0) {
    generatedXml = "";
    btnDownload.disabled = true;
    xmlPreview.textContent = "No se generó XML porque existen errores de validación.";
    showStatus("error", "Corrige los errores antes de generar el XML.");
    return;
  }

  generatedXml = buildXml(parsedData);
  xmlPreview.textContent = generatedXml;
  btnDownload.disabled = false;
  showStatus("success", "XML generado correctamente, sin CamposOriginales y sin duplicados.");
});

btnDownload.addEventListener("click", () => {
  if (!generatedXml || !parsedData) return;

  const order = parsedData.orden || "sin_orden";
  const date = parsedData.fecha || "sin_fecha";
  const filename = `factura_${safeFilename(order)}_${safeFilename(date)}.xml`;

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

btnClear.addEventListener("click", () => clearAll(true));

function parseChk(text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim());

  const data = {
    emisorNombre: "",
    emisorRfc: "",
    sucursal: "",
    fecha: "",
    hora: "",
    orden: "",
    guests: "",
    reprints: "",
    modo: "",
    centroIngreso: "",
    turno: "",
    subtotal: "0.00",
    impuesto: "0.00",
    total: "0.00",
    metodoPago: "",
    pagoImporte: "",
    pagoCambio: "",
    inclusiveTaxId: "",
    inclusiveTaxMonto: "",
    claveProdServ: "",
    claveUnidad: "",
    unidad: "",
    cerrado: "",
    empleado: { id: "", puesto: "", nombre: "", rol: "" },
    conceptos: []
  };

  for (const rawLine of lines) {
    const { key, value } = splitChkLine(rawLine);
    const normalizedKey = normalizeKey(key);

    switch (normalizedKey) {
      case "CLOSED":
        data.cerrado = value;
        break;

      case "EMPLOYEE": {
        const parts = splitCsv(value);
        data.empleado = {
          id: parts[0] || "",
          puesto: parts[1] || "",
          nombre: parts[2] || "",
          rol: parts[3] || ""
        };
        break;
      }

      case "DOB":
      case "DATE":
        data.fecha = formatDate(value);
        break;

      case "TIME":
        data.hora = value.trim();
        break;

      case "HEADER":
        data.sucursal = value.trim();
        break;

      case "FOOTER":
        if (value.toUpperCase().startsWith("RFC:")) {
          data.emisorRfc = value.replace(/RFC:/i, "").trim();
        } else if (!data.emisorNombre) {
          data.emisorNombre = value.trim();
        }
        break;

      case "ORDERNAME":
        data.orden = value.replace(/Order\s*#/i, "").trim();
        break;

      case "GUESTS":
        data.guests = value.trim();
        break;

      case "REPRINTS":
        data.reprints = value.trim();
        break;

      case "ORDERMODE":
        data.modo = value.trim();
        break;

      case "REVENUECENTER":
        data.centroIngreso = value.trim();
        break;

      case "DAYPART":
        data.turno = value.trim();
        break;

      case "ITEM":
        data.conceptos.push(parseItem(value, data));
        break;

      case "SUBTOTAL":
        data.subtotal = money(value);
        break;

      case "TAX":
        data.impuesto = money(value);
        break;

      case "TOTAL1ITEM":
      case "TOTAL":
        data.total = money(value);
        break;

      case "PAYMENT": {
        const parts = splitCsv(value);
        data.metodoPago = parts[0] || "";
        data.pagoImporte = money(parts[1] || "0");
        data.pagoCambio = money(parts[2] || "0");
        break;
      }

      case "INCLUSIVETAX": {
        const parts = splitCsv(value);
        data.inclusiveTaxId = parts[0] || "";
        data.inclusiveTaxMonto = money(parts[1] || "0");
        break;
      }

      case "CLAVEPRODSERV":
        data.claveProdServ = value.trim();
        break;

      case "UNIDAD":
        data.unidad = value.trim();
        data.claveUnidad = value.trim();
        break;

      case "CLAVEUNIDAD":
        data.claveUnidad = value.trim();
        break;
    }
  }

  if (!data.total || data.total === "0.00") {
    const calculated = Number(data.subtotal) + Number(data.impuesto);
    data.total = money(calculated);
  }

  data.conceptos = data.conceptos.map((concepto, index) => ({
    ...concepto,
    claveProdServ: concepto.claveProdServ || data.claveProdServ,
    claveUnidad: concepto.claveUnidad || data.claveUnidad || data.unidad,
    unidad: concepto.unidad || data.unidad || data.claveUnidad,
    noIdentificacion: concepto.noIdentificacion || `${data.orden || "CHK"}-${index + 1}`
  }));

  return data;
}

function validateData(data) {
  const validations = [];

  addRequired(validations, data.emisorNombre, "Nombre del emisor detectado");
  addRequired(validations, data.emisorRfc, "RFC del emisor detectado");
  addRequired(validations, data.sucursal, "Sucursal detectada");
  addRequired(validations, data.fecha, "Fecha detectada");
  addRequired(validations, data.hora, "Hora detectada");
  addRequired(validations, data.orden, "Número de orden detectado");
  addRequired(validations, data.claveProdServ, "ClaveProdServ detectada");
  addRequired(validations, data.claveUnidad || data.unidad, "Unidad / ClaveUnidad detectada");

  if (!data.conceptos.length) {
    validations.push({ type: "error", text: "No se detectaron conceptos ITEM en el archivo .CHK." });
  } else {
    validations.push({ type: "ok", text: `Conceptos detectados: ${data.conceptos.length}` });
  }

  const subtotal = Number(data.subtotal);
  const impuesto = Number(data.impuesto);
  const total = Number(data.total);
  const esperado = Number((subtotal + impuesto).toFixed(2));

  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    validations.push({ type: "error", text: "Subtotal inválido o en cero." });
  } else {
    validations.push({ type: "ok", text: `Subtotal válido: ${data.subtotal}` });
  }

  if (!Number.isFinite(total) || total <= 0) {
    validations.push({ type: "error", text: "Total inválido o en cero." });
  } else {
    validations.push({ type: "ok", text: `Total válido: ${data.total}` });
  }

  if (Math.abs(esperado - total) > 0.02) {
    validations.push({
      type: "warn",
      text: `El total no coincide exactamente con Subtotal + Impuesto. Esperado: ${esperado.toFixed(2)}, detectado: ${data.total}`
    });
  } else {
    validations.push({ type: "ok", text: "Subtotal + Impuesto coincide con el Total." });
  }

  if (!data.metodoPago) {
    validations.push({ type: "warn", text: "No se detectó método de pago." });
  } else {
    validations.push({ type: "ok", text: `Método de pago detectado: ${data.metodoPago}` });
  }

  return validations;
}

function addRequired(validations, value, label) {
  if (!String(value || "").trim()) {
    validations.push({ type: "error", text: `${label}: FALTA` });
  } else {
    validations.push({ type: "ok", text: `${label}: OK` });
  }
}

function splitChkLine(line) {
  const match = String(line).match(/^([A-Za-z0-9_]+)\s*(.*)$/);
  if (!match) return { key: "LINEA", value: line.trim() };
  return { key: match[1].trim(), value: (match[2] || "").trim() };
}

function normalizeKey(key) {
  return String(key || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function splitCsv(value) {
  return String(value || "").split(",").map(part => part.trim());
}

function parseItem(value, data) {
  const parts = splitCsv(value);
  const descripcion = parts[0] || "CONCEPTO";
  const precioUnitario = money(parts[1] || "0");
  const importe = money(parts[2] || precioUnitario);

  return {
    claveProdServ: data.claveProdServ || "",
    claveUnidad: data.claveUnidad || "",
    unidad: data.unidad || "",
    noIdentificacion: "",
    descripcion,
    cantidad: "1",
    precioUnitario,
    importe
  };
}

function buildXml(data) {
  const conceptosXml = data.conceptos.map(concepto => `    <Concepto>
      <ClaveProdServ>${xmlEscape(concepto.claveProdServ)}</ClaveProdServ>
      <ClaveUnidad>${xmlEscape(concepto.claveUnidad)}</ClaveUnidad>
      <Unidad>${xmlEscape(concepto.unidad)}</Unidad>
      <NoIdentificacion>${xmlEscape(concepto.noIdentificacion)}</NoIdentificacion>
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
    <Comensales>${xmlEscape(data.guests)}</Comensales>
    <Reimpresiones>${xmlEscape(data.reprints)}</Reimpresiones>
    <Cerrado>${xmlEscape(data.cerrado)}</Cerrado>
  </Comprobante>
  <Empleado>
    <Id>${xmlEscape(data.empleado.id)}</Id>
    <Puesto>${xmlEscape(data.empleado.puesto)}</Puesto>
    <Nombre>${xmlEscape(data.empleado.nombre)}</Nombre>
    <Rol>${xmlEscape(data.empleado.rol)}</Rol>
  </Empleado>
  <Conceptos>
${conceptosXml}
  </Conceptos>
  <Totales>
    <Subtotal>${xmlEscape(data.subtotal)}</Subtotal>
    <Impuesto>${xmlEscape(data.impuesto)}</Impuesto>
    <Total>${xmlEscape(data.total)}</Total>
    <ImpuestoIncluidoId>${xmlEscape(data.inclusiveTaxId)}</ImpuestoIncluidoId>
    <ImpuestoIncluidoMonto>${xmlEscape(data.inclusiveTaxMonto)}</ImpuestoIncluidoMonto>
  </Totales>
  <Pago>
    <Metodo>${xmlEscape(data.metodoPago)}</Metodo>
    <Importe>${xmlEscape(data.pagoImporte)}</Importe>
    <Cambio>${xmlEscape(data.pagoCambio)}</Cambio>
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
    ["ClaveProdServ", data.claveProdServ],
    ["ClaveUnidad", data.claveUnidad],
    ["Unidad", data.unidad],
    ["Subtotal", data.subtotal],
    ["Impuesto", data.impuesto],
    ["Total", data.total],
    ["Método pago", data.metodoPago],
    ["Conceptos", data.conceptos.map(c => `${c.descripcion} - ${c.claveProdServ} - ${c.unidad} - $${c.importe}`).join(", ")]
  ];

  dataPreview.innerHTML = rows.map(([label, value]) => `
    <div class="row">
      <strong>${label}</strong>
      <span>${xmlEscape(value) || "No detectado"}</span>
    </div>
  `).join("");
}

function renderValidations(validations) {
  validationPreview.innerHTML = validations.map(v => `
    <div class="validation-item ${v.type}">
      ${xmlEscape(v.text)}
    </div>
  `).join("");
}

function showStatus(type, message) {
  statusBox.className = `status ${type}`;
  statusBox.textContent = message;
}

function clearAll(resetFile = true) {
  parsedData = null;
  generatedXml = "";
  if (resetFile) fileInput.value = "";
  btnGenerate.disabled = true;
  btnDownload.disabled = true;
  statusBox.className = "status hidden";
  statusBox.textContent = "";
  dataPreview.innerHTML = `<p class="muted">Aún no se ha cargado ningún archivo.</p>`;
  validationPreview.innerHTML = `<p class="muted">Aquí aparecerá el resultado de validación.</p>`;
  xmlPreview.textContent = "El XML aparecerá aquí...";
}

function formatDate(value) {
  const clean = String(value || "").trim();
  if (/^\d{8}$/.test(clean)) {
    return `${clean.substring(0, 4)}-${clean.substring(4, 6)}-${clean.substring(6, 8)}`;
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

function safeFilename(value) {
  return String(value || "").replace(/[^a-z0-9_-]/gi, "_").replace(/_+/g, "_");
}
