// ==UserScript==
// @name         GRN - Etichette Collo BOM + CSV Distinta + Ricerca VDS
// @namespace    http://tampermonkey.net/
// @version      10.0
// @description  BOM perfetto + CSV completo + Etichette con QR nitidi (30x30) + campi ravvicinati+Equivalenze
// @author       Daniele Izzo
// @match        http://172.18.20.20/*
// @match        http://172.18.20.20:8095/*
// @require      https://cdn.jsdelivr.net/npm/papaparse@5.3.0/papaparse.min.js
// @grant        GM_download
// ==/UserScript==

(function() {
    'use strict';
    const LOGO_URL = "https://raw.githubusercontent.com/Daniele1995-design/WebAppSap/refs/heads/main/logo%20ats.jpg";
    const LOGO_URL2 = "https://raw.githubusercontent.com/Daniele1995-design/WebAppSap/refs/heads/main/PackingList.png";

    // ===================== CONFIG =====================
    // La distinta ora è gestita nativamente dalla WebApp (bom-section-*):
    // non si carica più il CSV BOM esterno. Resta solo il Catalogo BP (Material Code padre).
    let catalogoBP = {};
    const CATALOGO_BP_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTvprxVE4qAvY5PMFEoz1tUi3yIynkE0fjCAebj10_v3wJEj-ezdtgYvJawAh2DqLX40f3pH6WUcDbS/pub?gid=1382717559&single=true&output=csv";
    // ===================== UTILITY =====================
    const BOM_SEL = "[id^='bom-section-']";

    function getArticolo(li) {
        const header = li.querySelector("div[style*='display: flex']");
        if (!header) return '';
        const codeDiv = header.querySelector("div:nth-of-type(2)");
        if (!codeDiv) return '';
        return codeDiv.textContent.split('|')[0].trim().toUpperCase();
    }

    // Padre BOM = riga con l'avviso nativo "Articolo Con BOM"
    function isPadreBOM(li) {
        return Array.from(li.querySelectorAll('i.fa-exclamation')).some(i => {
            const box = i.closest('div');
            return box && /Articolo\s+Con\s+BOM/i.test(box.textContent);
        });
    }

    // Material Code padre dal Catalogo BP, senza zeri iniziali
    function getMaterialCodePadre(articolo) {
        const mc = (catalogoBP[articolo] || '').trim();
        return mc.replace(/^0+(?=\d)/, '') || '—';
    }

    // Seriale/lotto di una riga seriale, ignorando la sezione distinta
    function getSerialeRiga(sr) {
        const clone = sr.cloneNode(true);
        clone.querySelectorAll(`${BOM_SEL}, select`).forEach(el => el.remove());
        const txt = (clone.innerText || clone.textContent || '').trim();
        const match = txt.match(/(?:Seriale|Lotto)[\s:]+([A-Za-z0-9_-]+)/i);
        return match ? match[1].trim() : '';
    }

    // Righe seriale del padre: [{ seriale, bom }] (bom = elemento bom-section o null)
    function getRigheSeriali(li) {
        const out = [];
        li.querySelectorAll("div[id^='dropdown-'] ul > li").forEach(sr => {
            const seriale = getSerialeRiga(sr);
            if (seriale) out.push({ seriale, bom: sr.querySelector(BOM_SEL) });
        });
        return out;
    }

    function getSeriali(li) {
        return getRigheSeriali(li).map(r => r.seriale);
    }

    // Figli dalla distinta esplosa: codice | (materiale) | PN | Lotto/Seriale, Qtà
    function getFigliDaPagina(bomEl) {
        if (!bomEl) return [];
        const figli = [];
        bomEl.querySelectorAll(":scope > div[style*='border-top']").forEach(row => {
            const info = row.querySelector("div[style*='min-width:0']");
            if (!info) return;
            const campi = Array.from(info.querySelectorAll(':scope > div'));
            const codice = (campi[0]?.textContent || '').trim().toUpperCase();
            if (!codice) return;
            const pn = (campi[2]?.textContent || '').trim();
            let lotto = '';
            const tracking = campi.find(d => /^(?:Lotto|Seriale)\s*:/i.test(d.textContent.trim()));
            if (tracking) {
                lotto = tracking.textContent.trim().replace(/^(?:Lotto|Seriale)\s*:\s*/i, '').trim();
                if (/^da scansionare$/i.test(lotto)) lotto = '';
            }
            const qtaDiv = Array.from(row.querySelectorAll('div')).find(d => /^Qtà/i.test(d.textContent.trim()));
            const qty = qtaDiv ? qtaDiv.textContent.trim().replace(/^Qtà\s*/i, '').trim() : '';
            figli.push({ figlio: codice, pn, qty, lotto });
        });
        return figli;
    }

    function getDescrizione(li) {
        const divs = li.querySelectorAll('div');
        for (let div of divs) {
            const txt = div.textContent;
            if (txt.includes('Descrizione:')) {
                const match = txt.match(/Descrizione:\s*(.+)/i);
                return match ? match[1].trim() : '';
            }
        }
        return '';
    }
    function getRif(li) {
        const divs = li.querySelectorAll('div');
        for (let div of divs) {
            const txt = div.textContent;
            if (txt.includes('Rif:')) {
                const match = txt.match(/Rif:\s*(\d+)/i);
                return match ? match[1].trim() : '';
            }
        }
        return '';
    }

// ===================== GENERA LOTTO =====================
function generaLotto() {
    // Trova la select della commessa
    const commessaSelect = document.querySelector('#commessaTestata');
    if (!commessaSelect) {
        alert('Commessa non trovata!');
        return;
    }

    // Prendi il valore selezionato
    const commessaValue = commessaSelect.value;

    // CONTROLLA SE È VUOTA
    if (!commessaValue || commessaValue.trim() === '') {
        alert('⚠️ ATTENZIONE: Seleziona prima una Commessa!');
        return;
    }

    // Prendi le ultime 3 cifre
    const ultime3 = commessaValue.slice(-3);

    // Genera timestamp nel formato aaaammgg-hhmmss
    const now = new Date();
    const anno = now.getFullYear();
    const mese = String(now.getMonth() + 1).padStart(2, '0');
    const giorno = String(now.getDate()).padStart(2, '0');
    const ore = String(now.getHours()).padStart(2, '0');
    const minuti = String(now.getMinutes()).padStart(2, '0');
    const secondi = String(now.getSeconds()).padStart(2, '0');

    const timestamp = `${anno}${mese}${giorno}-${ore}${minuti}${secondi}`;

    // Crea il codice lotto finale
    const codiceLotto = `${ultime3}-${timestamp}`;

    // Trova l'input di ricerca e inserisci il valore
    const shootInput = document.querySelector('#shootInput');
    if (shootInput) {
        shootInput.value = codiceLotto;
        shootInput.focus();

        // Trigger evento input per aggiornare l'interfaccia
        const event = new Event('input', { bubbles: true });
        shootInput.dispatchEvent(event);
    } else {
        alert('Campo di ricerca non trovato!');
    }
}
function aggiungiPulsanteGeneraLotto() {
    // FRECCIA SINISTRA ◄ (Home)
    if (!document.getElementById('btn-freccia-home')) {
        const btnHome = document.createElement('button');
        btnHome.id = 'btn-freccia-home';
        btnHome.innerHTML = '🏠';
        btnHome.title = 'Torna alla Home';
        btnHome.style.cssText = `
            position: fixed; top: 10px; left: 10px; z-index: 10000;
            width: 40px; height: 40px; padding: 0;
            background: white; color: #333; border: 2px solid #ddd;
            border-radius: 3px; font-size: 20px; font-weight: bold;
            cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            display: flex; align-items: center; justify-content: center;
        `;
        btnHome.onclick = () => {
            window.location.href = 'http://172.18.20.20/';
        };
        btnHome.onmouseenter = () => btnHome.style.background = '#f0f0f0';
        btnHome.onmouseleave = () => btnHome.style.background = 'white';

        document.body.appendChild(btnHome);
    }

    // SALVATAGGIO AUTOMATICO
    let ultimoUrl = '';
    setInterval(() => {
        const urlCorrente = window.location.href;
        if (urlCorrente !== ultimoUrl && urlCorrente !== 'http://172.18.20.20/') {
            ultimoUrl = urlCorrente;
            localStorage.setItem('linkMemorizzato', urlCorrente);
        }
    }, 500);
}

//  FUNZIONE per gestire il pulsante
function gestisciPulsanteLotto() {
    const urlCorrente = window.location.href;

    if (!urlCorrente.includes('/GRN/')) {
        const btnLottoEsistente = document.getElementById('btn-genera-lotto');
        if (btnLottoEsistente) btnLottoEsistente.remove();
        return;
    }

    const menuFunzioni = document.getElementById('menu-funzioni');
    const wizard = document.getElementById('wizard');
    const grnArticoli = document.getElementById('grn-articoli');

    const menuFunzioniVisibile = menuFunzioni && window.getComputedStyle(menuFunzioni).display !== 'none';
    const wizardVisibile = wizard && window.getComputedStyle(wizard).display !== 'none';
    const grnArticoliVisibile = grnArticoli && window.getComputedStyle(grnArticoli).display !== 'none';

    const btnLottoEsistente = document.getElementById('btn-genera-lotto');

    //  Mostra il pulsante se:
    // - grn-articoli è VISIBILE (pagina dove serve il pulsante)
    // - OPPURE se menu-funzioni e wizard sono entrambi nascosti
    if ((grnArticoliVisibile || (!menuFunzioniVisibile && !wizardVisibile)) && !btnLottoEsistente) {
        const btnLotto = document.createElement('button');
        btnLotto.id = 'btn-genera-lotto';
        btnLotto.innerHTML = '📦 Genera Lotto';
        btnLotto.title = 'Genera codice lotto automatico';
          btnLotto.style.cssText = `
            position: fixed !important;
            top: 10px !important;
            left: 60px !important;
            z-index: 10000 !important;
            width: 140px !important;
            height: 40px !important;
            padding: 0 !important;
            background: #4caf50 !important;
            color: #333 !important;
            border: 2px solid #4caf50 !important;
            border-radius: 3px !important;
            font-size: 15px !important;
            font-weight: bold !important;
            cursor: pointer !important;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        `;
        btnLotto.onclick = generaLotto;
        btnLotto.onmouseenter = () => btnLotto.style.background = '#f0f0f0';
        btnLotto.onmouseleave = () => btnLotto.style.background = '#4caf50';

        document.body.appendChild(btnLotto);
    }
    // ❌ Nascondi il pulsante se menu o wizard sono visibili E grn-articoli è nascosto
    else if ((menuFunzioniVisibile || wizardVisibile) && !grnArticoliVisibile && btnLottoEsistente) {
        btnLottoEsistente.remove();
    }
}

//  AVVIO
aggiungiPulsanteGeneraLotto();
gestisciPulsanteLotto();

//  INTERVALLO molto frequente
setInterval(gestisciPulsanteLotto, 100);

//  MUTATION OBSERVER aggressivo
new MutationObserver(() => {
    gestisciPulsanteLotto();
}).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'display']
});

//  Intercetta TUTTI i click sulla pagina
document.addEventListener('click', () => {
    setTimeout(gestisciPulsanteLotto, 50);
    setTimeout(gestisciPulsanteLotto, 200);
    setTimeout(gestisciPulsanteLotto, 500);
});

//  Timeout multipli all'avvio
setTimeout(gestisciPulsanteLotto, 500);
setTimeout(gestisciPulsanteLotto, 1000);
setTimeout(gestisciPulsanteLotto, 2000);
setTimeout(gestisciPulsanteLotto, 3000);
    function getPosizione(li) {
        const divs = li.querySelectorAll('div');
        for (let div of divs) {
            const txt = div.textContent;
            if (txt.includes('Posizione:')) {
                const match = txt.match(/Posizione:\s*(\d+)/i);
                return match ? match[1].trim() : '';
            }
        }
        return '';
    }
    // ===================== CATALOGO BP =====================
function caricaCatalogoBP() {
    Papa.parse(CATALOGO_BP_URL, {
        download: true,
        header: false,
        skipEmptyLines: true,
        complete: function(results) {
            results.data.forEach((row, i) => {
                if (i === 0) return; // salta intestazione
                const codiceArticolo = (row[0] || "").trim().toUpperCase();
                const nCatalogoBP = (row[2] || "").trim(); // colonna C
                if (codiceArticolo && nCatalogoBP) {
                    catalogoBP[codiceArticolo] = nCatalogoBP;
                }
            });
            console.log(`✅ Catalogo BP caricato: ${Object.keys(catalogoBP).length} voci`);
            aggiornaRigheCatalogoBP();
        },
        error: function() {
            console.warn("⚠️ Errore caricamento Catalogo BP");
        }
    });
}

function aggiornaRigheCatalogoBP() {
    if (Object.keys(catalogoBP).length === 0) return; // aspetta che il catalogo sia caricato
    document.querySelectorAll('li.item-content.item-input.item-input-outline').forEach(li => {
        const headerDiv = li.querySelector("div[style*='display: flex'] div:nth-of-type(2)");
        if (!headerDiv) return;
        if (headerDiv.dataset.bpInjected) return;

        const testo = headerDiv.textContent.trim();
        const parti = testo.split('|');
        if (parti.length < 2) return;

        const codice = parti[0].trim().toUpperCase();
        const resto = parti.slice(1).join('|').trim();
        const bp = catalogoBP[codice] || '—';

        headerDiv.textContent = `${codice} | ${bp} | ${resto}`;
        headerDiv.dataset.bpInjected = 'true';
    });
}

    // ===================== PULSANTI RIGA – SOLO SU PADRI =====================
    function aggiungiPulsantiBOM() {
        document.querySelectorAll('li.item-content.item-input.item-input-outline').forEach(li => {
            if (li.querySelector('.print-singola-ats')) return;
            const articolo = getArticolo(li);
            if (!articolo) return;
            if (!isPadreBOM(li)) return; // solo padri

            const stampaBtn = li.querySelector('button[title="Opzioni di stampa etichetta"]');
            if (!stampaBtn) return;
            const container = stampaBtn.parentNode;
            container.style.display = 'inline-flex';
            container.style.alignItems = 'center';
            container.style.gap = '8px';

            // Pulsante stampa etichetta singola ATS
            const printBtn = document.createElement('button');
            printBtn.className = 'print-singola-ats';
            printBtn.title = 'Stampa Etichetta Collo (solo questo padre)';
            printBtn.style.cssText = `
                padding:0; border:none; background:transparent; cursor:pointer;
                width:40px; height:40px; display:inline-flex; align-items:center; justify-content:center;
            `;
            const img = document.createElement('img');
            img.src = LOGO_URL2;
            img.alt = 'ATS';
            img.style.cssText = 'width:36px; height:36px; object-fit:contain; border-radius:4px;';
            printBtn.appendChild(img);
            printBtn.onclick = () => stampaEtichettaSingola(articolo, li);

            container.insertBefore(printBtn, stampaBtn.nextSibling);
        });
    }
    // ===================== GENERAZIONE ETICHETTA =====================
    function generaEtichettaHTML(padre, materialCode, seriale, figli, commessa, rif) {
        const qrIdMaterial = 'qr-material-' + Math.random().toString(36).substr(2, 9);
        const qrIdSeriale = 'qr-seriale-' + Math.random().toString(36).substr(2, 9);

        return `
        <div class="etichetta">
            <div class="header">
                <img src="${LOGO_URL}" class="logo" alt="ATS">
                <h2>CONTENUTO COLLO</h2>
            </div>
            <div class="info">
                <p class="line compact"><strong>Padre:</strong> <span class="codice">${padre}</span></p>

                <!-- Material Code + QR 50x50 -->
                <div class="line material-row">
                    <span><strong>Material Code:</strong> ${materialCode}</span>
                    <canvas id="${qrIdMaterial}" class="qr-code" data-text="${materialCode}"></canvas>
                </div>

                <!-- Seriale + QR 50x50 sotto -->
                <div class="line material-row">
                    <span><strong>Seriale:</strong> <span class="seriale">${seriale}</span></span>
                    <canvas id="${qrIdSeriale}" class="qr-code" data-text="${seriale}"></canvas>
                </div>
            </div>
            <hr>
            <h3>Componenti:</h3>
            <table>
                <thead><tr><th>Codice</th><th>SapCode</th><th>Qty</th><th>Lotto/SN</th></tr></thead>
                <tbody>
                   ${figli.map(f =>
                       `<tr><td><strong>${f.figlio}</strong></td><td>${f.pn || '—'}</td><td>${f.qty}</td><td>${f.lotto || '—'}</td></tr>`
                   ).join('')}
                </tbody>
            </table>
            <div class="footer">Commessa: ${commessa} | Rif: ${rif}</div>
        </div>`;
    }
    // ===================== FINESTRA STAMPA =====================
    function apriFinestraStampa(contenutoHTML, titolo) {
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>${titolo}</title>
           <style>
    body {
        margin:0;
        padding:12px;
        background:#f8f8f8;
        font-family:Arial,sans-serif;
    }

    .etichetta {
        width:9.5cm;
        min-height:10cm;          /*  NON height */
        margin:0 auto 10px;
        padding:6px;
        box-sizing:border-box;
        background:white;
        border:2px solid #333;

        display:flex;
        flex-direction:column;

        page-break-inside: avoid;
        break-after: page;        /*  moderno */
    }

    .header {
        display:flex;
        align-items:center;
        margin-bottom:1px;
    }

    .logo {
        width:55px;
        height:55px;
        object-fit:contain;
        margin-right:8px;
    }

    h2 {
        margin:0;
        font-size:1.15em;
        color:#003087;
        flex-grow:1;
        text-align:center;
    }

    .info {
        font-size:0.78em;
        line-height:1;
        margin-bottom:2px;
    }

    .line { margin:1px 0; }
    .line.compact { margin:0; }

    .material-row {
        display:flex;
        align-items:center;
        justify-content:space-between;
        margin:2px 0;
        gap:12px;
    }

    .qr-code {
        width:30px;
        height:30px;
        flex-shrink:0;
        margin:2px 0;
    }

    .codice {
        font-size:1.05em;
        font-weight:bold;
        color:#d32f2f;
    }

    .seriale {
        font-size:1.15em;
        font-weight:bold;
        color:#1976d2;
    }

    hr {
        margin:2px 0;
        border-top:1px solid #ccc;
    }

    h3 {
        margin:1px 0 2px;
        font-size:0.82em;
    }

    table {
        width:100%;
        border-collapse:collapse;
        font-size:0.66em;
        flex-grow:1;
    }

    th, td {
        border:1px solid #999;
        padding:1px 2px;
        text-align:left;
    }

    th {
        background:#f0f0f0;
        font-weight:bold;
    }

    .footer {
        text-align:center;
        font-size:0.58em;
        color:#555;
        margin-top:4px;
    }

    @media print {
        body {
            padding:0;
            background:white;
        }

        .etichetta {
            border:none;
            margin:0;
            break-after: page;
        }
    }
</style>
        </head>
        <body onload="generaQR(); setTimeout(() => window.print(), 500);">
            ${contenutoHTML}
            <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js"></script>
            <script>
                function generaQR() {
                    document.querySelectorAll('.qr-code').forEach(canvas => {
                        const text = canvas.getAttribute('data-text');
                        if (text && text !== '—') {
                            QRCode.toCanvas(canvas, text.trim(), {
                                errorCorrectionLevel: 'M',
                                width: 30,
                                margin: 1
                            });
                        }
                    });
                }
                window.onafterprint = () => window.close();
                window.matchMedia('print').addListener(m => { if (!m.matches) window.close(); });
            </script>
        </body>
        </html>`);
        printWindow.document.close();
        printWindow.focus();
    }

    // ===================== STAMPA =====================
    // Genera le etichette di un padre; restituisce { html, nonEsplosi }
    function etichettePadre(padre, li, commessa, rif) {
        const materialCode = getMaterialCodePadre(padre);
        let html = '';
        const nonEsplosi = [];
        getRigheSeriali(li).forEach(({ seriale, bom }) => {
            const figli = getFigliDaPagina(bom);
            if (!bom || figli.length === 0) { nonEsplosi.push(`${padre} – ${seriale}`); return; }
            html += generaEtichettaHTML(padre, materialCode, seriale, figli, commessa, rif);
        });
        return { html, nonEsplosi };
    }

    function avvisoNonEsplosi(nonEsplosi) {
        return `⚠️ Distinta non esplosa per:\n${nonEsplosi.join('\n')}\n\nPremi il pulsante Distinta sulla riga e riprova.`;
    }

    function stampaEtichettaSingola(padre, li) {
        if (getSeriali(li).length === 0) {
            alert('Nessun seriale scansionato per questo padre');
            return;
        }
        const commessa = document.querySelector('#commessaTestata')?.value || '';
        const rif = document.querySelector('#Riferimento')?.value?.trim() || '';
        const { html, nonEsplosi } = etichettePadre(padre, li, commessa, rif);
        if (nonEsplosi.length) alert(avvisoNonEsplosi(nonEsplosi));
        if (!html) return;
        apriFinestraStampa(html, `Etichetta - ${padre}`);
    }

    function stampaTutteEtichette() {
        let html = '';
        const nonEsplosi = [];
        const commessa = document.querySelector('#commessaTestata')?.value || '';
        const rif = document.querySelector('#Riferimento')?.value?.trim() || '';
        document.querySelectorAll('li.item-content.item-input.item-input-outline').forEach(li => {
            if (!isPadreBOM(li)) return;
            const padre = getArticolo(li);
            if (!padre) return;
            const r = etichettePadre(padre, li, commessa, rif);
            html += r.html;
            nonEsplosi.push(...r.nonEsplosi);
        });
        if (nonEsplosi.length) alert(avvisoNonEsplosi(nonEsplosi));
        if (!html) {
            if (!nonEsplosi.length) alert('Nessun collo con seriale trovato');
            return;
        }
        apriFinestraStampa(html, 'Tutte le Etichette Collo');
    }
    // ===================== CSV CON NUMERO RIGA =====================
    const forceText = v => `="${String(v ?? '').replace(/"/g, '""')}"`;
    function toCSV(rows) {
        return 'sep=;\n' + rows.map(r => r.map(forceText).join(';')).join('\n');
    }

    function estraiReportBOM() {
        // Colonna "Lotto/SN Figlio" aggiunta in coda per non spostare le esistenti
        const out = [['Riga', 'Padre', 'Material Code Padre', 'Descrizione', 'Rif', 'Posizione', 'Seriale', 'Codice', 'PN', 'Quantità', 'Lotto/SN Figlio']];
        const nonEsplosi = [];

        document.querySelectorAll('li.item-content.item-input.item-input-outline').forEach(li => {
            // Estrai numero riga #001 ecc.
            const rigaSpan = li.querySelector('span[style*="background-color: bisque"] b');
            const numeroRiga = rigaSpan ? rigaSpan.textContent.trim() : '';

            const articolo = getArticolo(li);
            const descrizione = getDescrizione(li);
            const rif = getRif(li);
            const posizione = getPosizione(li);
            const righe = getRigheSeriali(li);
            if (!articolo || righe.length === 0) return;

            if (isPadreBOM(li)) {
                const materialCode = getMaterialCodePadre(articolo);
                righe.forEach(({ seriale, bom }) => {
                    out.push([numeroRiga, articolo, materialCode, descrizione, rif, posizione, seriale, '', '', 1, '']);
                    const figli = getFigliDaPagina(bom);
                    if (figli.length === 0) nonEsplosi.push(`${articolo} – ${seriale}`);
                    figli.forEach(f => {
                        out.push([numeroRiga, articolo, materialCode, descrizione, rif, posizione, '', f.figlio, f.pn || '', f.qty, f.lotto || '']);
                    });
                });
            } else {
                righe.forEach(({ seriale }) => {
                    out.push([numeroRiga, articolo, '', descrizione, rif, posizione, seriale, '', '', 1, '']);
                });
            }
        });
        if (nonEsplosi.length && !confirm(avvisoNonEsplosi(nonEsplosi) + '\n\nEsportare comunque (senza figli per queste righe)?')) {
            return [out[0]];
        }
        return out;
    }
    function downloadCSVBOM() {
        const rows = estraiReportBOM();
        if (rows.length <= 1) {
            alert('Nessun dato BOM trovato');
            return;
        }
        const commessa = document.querySelector('#commessaTestata')?.value || 'SenzaCommessa';
        const rif = document.querySelector('#Riferimento')?.value?.trim() || 'SenzaRif';
        const csv = toCSV(rows);
        GM_download({
            url: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv),
            name: `${commessa}_BOM_${rif}.csv`,
            saveAs: true
        });
    }

 // ===================== UI EXPORT =====================
    function addExportUI() {
        //  NON mostrare i pulsanti se siamo su /Pick/
        if (window.location.href.includes('/Pick/')) return;

        let wrapper = document.getElementById('export-print-wrapper');
        if (!wrapper) {
            const modal = document.querySelector('.sheet-modal-inner .sheet-modal-swipe-step');
            if (!modal) return;
            wrapper = document.createElement('div');
            wrapper.id = 'export-print-wrapper';
            wrapper.style.cssText = `
                display: flex; flex-flow: wrap; gap: 10px; padding: 10px; margin-top: 20px;
                border-top: 1px solid #ddd; justify-content: space-between; width: 100%; box-sizing: border-box;
            `;
            modal.appendChild(wrapper);
        }
        if (document.getElementById('btn-custom-csv-bom')) return;

        const btnCSV = document.createElement('button');
        btnCSV.id = 'btn-custom-csv-bom';
        btnCSV.innerHTML = '📄 CSV CON INTEGRAZIONE BOM';
        btnCSV.title = 'Estrai Report CSV BOM';
        btnCSV.style.cssText = `
            flex: 1 1 0%; min-width: 120px; text-align: center; padding: 8px 5px; margin: 2px;
            font-size: 12px; border: none; border-radius: 4px; cursor: pointer; color: white;
            font-weight: bold; background-color: blue;
        `;
        btnCSV.onclick = downloadCSVBOM;

        const btnAll = document.createElement('button');
        btnAll.id = 'btn-custom-stampa-tutte';
        btnAll.innerHTML = '📋 Stampa Tutte PL BOM';
        btnAll.title = 'Stampa Tutte le PackingList 10x10';
        btnAll.style.cssText = `
            flex: 1 1 0%; min-width: 120px; text-align: center; padding: 8px 5px; margin: 2px;
            font-size: 12px; border: none; border-radius: 4px; cursor: pointer; color: white;
            font-weight: bold; background-color: orange;
        `;
        btnAll.onclick = stampaTutteEtichette;

        wrapper.appendChild(btnCSV);
        wrapper.appendChild(btnAll);
    }

    // ===================== AVVIO =====================
    aggiungiPulsantiBOM();
    addExportUI();
    aggiungiPulsanteGeneraLotto();
    caricaCatalogoBP();
new MutationObserver(() => {
    aggiungiPulsantiBOM();
    addExportUI();
    aggiornaRigheCatalogoBP();
    // Aggiungi i pulsanti solo se non esistono già
    if (!document.getElementById('btn-freccia-home')) {
        aggiungiPulsanteGeneraLotto();
    }
    function aggiungiRicercaVDS() {
    const dialog = document.getElementById('dialogRiceraVDS');
    if (!dialog || dialog.dataset.searchInjected) return;
    const listaDiv = dialog.querySelector('.list.media-list');
    if (!listaDiv) return;

    const searchWrapper = document.createElement('div');
    searchWrapper.style.cssText = `
        padding: 8px 10px;
        position: sticky;
        top: 0;
        background: white;
        z-index: 10;
        border-bottom: 1px solid #ddd;
    `;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '🔍 Cerca per AWB , reference, plant...';
    searchInput.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        font-size: 14px;
        border: 2px solid #1565c0;
        border-radius: 6px;
        box-sizing: border-box;
        outline: none;
    `;

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        const items = dialog.querySelectorAll('#listaVDS > li');
        items.forEach(li => {
            const testo = li.textContent.toLowerCase();
            li.style.display = (!query || testo.includes(query)) ? '' : 'none';
        });
    });

    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input'));
        }
    });

    searchWrapper.appendChild(searchInput);
    listaDiv.parentNode.insertBefore(searchWrapper, listaDiv);
    setTimeout(() => searchInput.focus(), 100);
    dialog.dataset.searchInjected = 'true';
}
    aggiungiRicercaVDS();
}).observe(document.body, { childList: true, subtree: true });
})();