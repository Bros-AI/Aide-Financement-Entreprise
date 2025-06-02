// script.js

// Global chart instances
let domainChart, sizeChart, regionChart, ageChart;
const CONFIG = { CHUNK_SIZE: 1000, ITEM_HEIGHT: 320 }; // CHUNK_SIZE can be reduced for debugging stack overflows

function fixFrenchAccents(input) {
  if (typeof input !== 'string') {
    // console.warn(`fixFrenchAccents received non-string input (type: ${typeof input}, value: ${input}). Returning as is.`);
    return input; // Return non-strings as they are
  }
  if (!input) { // Handles empty string
    return '';
  }
  try {
    // This regex is simple, stack overflow here is highly unusual for this regex itself.
    // It usually points to an extremely large input string or an external issue.
    return input.replace(/�/g, 'é');
  } catch (e) {
    console.error(`Error in fixFrenchAccents with input (first 100 chars): "${String(input).substring(0,100)}..."`, e);
    return input; // Return original input on error
  }
}

async function loadDataFromURLManualFetch(url) {
  const fundingGrid = document.getElementById('funding-grid');
  fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem;">ATTEMPTING TO LOAD DATA FROM: ${url}... PATIENCE, YOUNG PADAWAN.</div>`;
  console.log(`Attempting to fetch from GitHub Pages: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors', 
    });

    console.log("Fetch response received. Status:", response.status, "OK:", response.ok);
    
    if (!response.ok) {
      let errorDetails = `HTTP error! Status: ${response.status}. URL: ${url}.`;
      try {
        const errorText = await response.text();
        errorDetails += ` Response body (first 200 chars): ${errorText.substring(0, 200)}`;
      } catch (e) {
        errorDetails += ` Could not read error response body.`;
      }
      errorDetails += `\nEnsure the file path is correct and accessible on GitHub Pages. Check the Network tab in browser dev tools.`;
      throw new Error(errorDetails);
    }

    console.log("Response Headers:");
    response.headers.forEach((value, name) => {
      console.log(`  ${name}: ${value}`);
    });
    
    const contentType = response.headers.get("content-type");
    console.log("Content-Type:", contentType);
    if (!contentType || (!contentType.includes("csv") && !contentType.includes("text/plain") && !contentType.includes("application/octet-stream"))) {
        console.warn("WARNING: Content-Type from GitHub Pages is not explicitly CSV/text. It is:", contentType, ". Proceeding with PapaParse.");
    }

    const blob = await response.blob();
    const textDecoder = new TextDecoder('ISO-8859-1');
    const decodedText = textDecoder.decode(await blob.arrayBuffer());

    console.log("Data fetched and decoded via TextDecoder. Length:", decodedText.length, "Parsing with PapaParse...");
    
    let processedData = [];
    let rowCounter = 0; // For more detailed logging if needed

    Papa.parse(decodedText, { 
        header: true, 
        skipEmptyLines: true, 
        delimiter: ';',
        chunkSize: CONFIG.CHUNK_SIZE, 
        chunk: function(results, parser) { // Added parser argument
            // console.log(`Processing chunk. Rows in this chunk: ${results.data.length}. Total rows processed before this chunk: ${rowCounter}`);
            if (results.errors.length > 0) {
                console.warn("PapaParse errors in this chunk:", results.errors);
                results.errors.forEach(err => {
                  console.warn(`PapaParse error detail: Type: ${err.type}, Code: ${err.code}, Message: ${err.message}, Row: ${err.row}`);
                });
            }
            try {
              const cleanedChunk = results.data.map((row, indexInChunk) => { 
                  const globalRowIndex = rowCounter + indexInChunk;
                  const cleanedRow = {};
                  for (const key in row) {
                      if (Object.prototype.hasOwnProperty.call(row, key)) {
                          const originalValue = row[key];
                          cleanedRow[key] = fixFrenchAccents(originalValue);
                          // Verbose logging - uncomment if stack overflow persists to find problematic data
                          // if (typeof originalValue === 'string' && originalValue.length > 5000) { // Log very long strings
                          //   console.log(`Row ${globalRowIndex}, Key: ${key}, Original (type: ${typeof originalValue}, length: ${originalValue.length}): "${String(originalValue).substring(0,100)}..."`);
                          // }
                      }
                  }
                  return cleanedRow;
              });
              processedData = processedData.concat(cleanedChunk);
              rowCounter += results.data.length;
            } catch (e) {
              console.error("Error during chunk processing (map or fixFrenchAccents):", e);
              console.error("Problematic chunk data (first few rows):", results.data.slice(0,3)); // Log some of the data that caused the issue
              parser.abort(); // Stop parsing if a chunk causes a critical error like stack overflow
              fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem; color:#e11d48;">CRITICAL ERROR during data processing. Parsing aborted. Check console.</div>`;
              // Optionally, re-throw or handle more gracefully
              throw e; // Re-throw to be caught by the outer try-catch if needed
            }
        },
        complete: function() {
            console.log(`PapaParse (from GitHub Pages fetch & TextDecoder) COMPLETE. Total rows acquired: ${processedData.length}`);
            if (processedData.length === 0 && rowCounter === 0) { // Check if any rows were ever processed
              console.warn("WARNING: No data parsed from GitHub Pages file or the file is empty. CHECK THE CSV CONTENT AND PATH.");
              fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--gray);">MISSION COMPROMISED: Aucune donnée exploitée depuis le fichier sur GitHub Pages '${url}'. Vérifiez le fichier et la console.</div>`;
              window.currentAides = [];
              updateStatistics([]); createCharts([]); displayAidCards([]); initSearchAndFilters([]);
              return;
            }
            window.currentAides = processedData;
            updateStatistics(processedData); createCharts(processedData);
            displayAidCards(processedData); initSearchAndFilters(processedData);
            // Scroll to funding list might be jarring if loading takes long, consider user experience
            // document.getElementById('funding-list').scrollIntoView({ behavior: 'smooth' }); 
            console.log("Data processing complete, UI updated.");
        },
        error: function(papaparseError, file) { // Added file argument
            console.error("!!!PAPA PARSE OVERALL FAILURE!!! DETAILS:", papaparseError);
            fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem; color:#e11d48;">SYSTEM ERROR: Échec du parsing CSV du fichier depuis GitHub Pages. <br>Diagnosis: ${papaparseError.message || 'Unknown PapaParse error'}. Check console.</div>`;
        }
    });

  } catch (error) { // This catches errors from fetch itself, or re-thrown errors from chunk processing
    console.error("!!!GITHUB PAGES FETCH OR PROCESSING CRITICAL FAILURE!!! DETAILS:", error);
    let reason = error.message || "Unknown fetch or processing error.";
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        reason += " This could be a network issue, an incorrect URL. Double-check the URL and Network tab.";
    } else if (error.name === 'RangeError' && error.message.includes('Maximum call stack size exceeded')) {
        reason += " This often indicates an issue with processing a very large piece of data or a deep recursion. Try reducing CHUNK_SIZE or inspect data for anomalies."
    }
    fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem; color:#e11d48;">SYSTEM ERROR: Échec du chargement ou traitement du fichier depuis GitHub Pages '${url}'. <br>Diagnosis: ${reason}. <br>CHECK CONSOLE AND NETWORK TAB.</div>`;
  }
}


function updateStatistics(aides) {
  if (!aides) aides = [];
  document.getElementById('stat-total').textContent = aides.length;
  const aidesNationales = aides.filter(aide => aide.couverture_geo === 'aide nationale');
  document.getElementById('stat-national').textContent = aidesNationales.length;
  const aidesTerritoriales = aides.filter(aide => aide.couverture_geo === 'aide territoriale');
  document.getElementById('stat-territorial').textContent = aidesTerritoriales.length;
  
  let totalAmount = 0;
  let countWithAmount = 0;
  if (aides.length > 0) {
    aides.forEach(aide => {
        const montantText = aide.aid_montant || '';
        // Regex to find numbers, allowing for spaces as thousands separators
        const montantMatch = montantText.match(/\d[\d\s]*\d*?/); // Adjusted to be less greedy with last \d*
        if (montantMatch) {
          const montantCleaned = montantMatch[0].replace(/\s/g, ''); // Remove spaces
          const montant = parseInt(montantCleaned, 10);
          if (!isNaN(montant)) {
              totalAmount += montant;
              countWithAmount++;
          }
        }
    });
  }
  
  const avgAmount = countWithAmount > 0 ? Math.round(totalAmount / countWithAmount) : 0;
  document.getElementById('stat-montant').textContent = new Intl.NumberFormat('fr-FR').format(avgAmount) + " €";
}

function createCharts(aides) {
  if (!aides) aides = [];

  const pieTooltipCallback = {
    callbacks: {
        label: function(context) {
            const label = context.label || '';
            const value = context.raw;
            if (typeof value !== 'number') return `${label}: N/A`; // Handle non-numeric raw values
            const total = context.chart.getDatasetMeta(0).total; 
            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
            return `${label}: ${value} (${percentage}%)`;
        }
    }
  };

  // 1. Domain Chart
  const domainCounts = {};
  if (aides.length > 0) {
    aides.forEach(aide => {
        if (aide.id_domaine && typeof aide.id_domaine === 'string') {
          const splitted = aide.id_domaine.split(',').map(s => s.trim());
          splitted.forEach(dom => {
              if (dom) { domainCounts[dom] = (domainCounts[dom] || 0) + 1; }
          });
        }
    });
  }
  
  const sortedDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8); 
  
  const domainCtx = document.getElementById('domain-chart').getContext('2d');
  if (domainChart) { domainChart.destroy(); } 
  domainChart = new Chart(domainCtx, {
    type: 'pie',
    data: {
      labels: sortedDomains.length > 0 ? sortedDomains.map(d => d[0]) : ['Aucune donnée'],
      datasets: [{
        data: sortedDomains.length > 0 ? sortedDomains.map(d => d[1]) : [1], // Default to 1 if no data for chart to render
        backgroundColor: sortedDomains.length > 0 ? ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#10b981', '#34d399', '#1e3a8a'] : ['#cccccc']
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false, 
      plugins: { 
        legend: { position: 'bottom', display: sortedDomains.length > 0 },
        tooltip: { ...pieTooltipCallback, enabled: sortedDomains.length > 0 }
      } 
    }
  });

  // 2. Size Chart
  const sizeCounts = { 'Moins de 10': 0, '10-49': 0, '50-249': 0, '250 et plus': 0, 'Toutes tailles': 0, 'Non spécifié': 0 };
  if (aides.length > 0) {
    aides.forEach(aide => {
        let found = false;
        const effectifStr = (typeof aide.effectif === 'string' ? aide.effectif : '').toLowerCase();
        if (effectifStr) {
            if (effectifStr.includes('-10') || effectifStr.includes('-5')) { sizeCounts['Moins de 10']++; found = true; }
            else if (effectifStr.includes('10-49')) { sizeCounts['10-49']++; found = true; }
            else if (effectifStr.includes('50-249')) { sizeCounts['50-249']++; found = true; }
            else if (effectifStr.includes('250 et plus')) { sizeCounts['250 et plus']++; found = true; }
            else if (effectifStr.includes('tous') || effectifStr.includes('all')) { sizeCounts['Toutes tailles']++; found = true; }
        }
        if (!found) sizeCounts['Non spécifié']++;
    });
  }
  
  const sizeCtx = document.getElementById('size-chart').getContext('2d');
  if (sizeChart) { sizeChart.destroy(); }
  sizeChart = new Chart(sizeCtx, {
    type: 'bar',
    data: {
      labels: Object.keys(sizeCounts),
      datasets: [{
        label: "Nombre d'aides",
        data: Object.values(sizeCounts),
        backgroundColor: '#1e40af'
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false, 
      plugins: { legend: { display: false } }, 
      scales: { y: { beginAtZero: true, suggestedMax: aides.length > 0 ? undefined : 10 } } 
    }
  });
  
  // 3. Region Chart
  const regionCounts = { 'Nationale': 0, 'Territoriale': 0, 'Non spécifié': 0 };
  if (aides.length > 0) {
    aides.forEach(aide => {
        if (aide.couverture_geo === 'aide nationale') regionCounts['Nationale']++;
        else if (aide.couverture_geo === 'aide territoriale') regionCounts['Territoriale']++;
        else regionCounts['Non spécifié']++;
    });
  }
  
  const regionCtx = document.getElementById('region-chart').getContext('2d');
  if (regionChart) { regionChart.destroy(); }
  regionChart = new Chart(regionCtx, {
    type: 'doughnut',
    data: {
      labels: aides.length > 0 ? Object.keys(regionCounts) : ['Aucune donnée'],
      datasets: [{
        data: aides.length > 0 ? Object.values(regionCounts) : [1],
        backgroundColor: aides.length > 0 ? ['#1e40af', '#10b981', '#64748b'] : ['#cccccc']
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false, 
      plugins: { 
        legend: { position: 'bottom', display: aides.length > 0},
        tooltip: { ...pieTooltipCallback, enabled: aides.length > 0 }
      } 
    }
  });
  
  // 4. Age Chart
  const ageCounts = { 'Moins de 3 ans': 0, 'Plus de 3 ans': 0, 'Tout âge': 0, 'Non spécifié': 0 };
  if (aides.length > 0) {
    aides.forEach(aide => {
        const ageEntrepriseStr = typeof aide.age_entreprise === 'string' ? aide.age_entreprise : '';
        if (!ageEntrepriseStr) ageCounts['Non spécifié']++;
        else if (ageEntrepriseStr.includes('- de 3 ans')) ageCounts['Moins de 3 ans']++;
        else if (ageEntrepriseStr.includes('+ de 3 ans')) ageCounts['Plus de 3 ans']++;
        else ageCounts['Tout âge']++; 
    });
  }
  
  const ageCtx = document.getElementById('age-chart').getContext('2d');
  if (ageChart) { ageChart.destroy(); }
  ageChart = new Chart(ageCtx, {
    type: 'bar',
    data: {
      labels: Object.keys(ageCounts),
      datasets: [{
        label: "Nombre d'aides",
        data: Object.values(ageCounts),
        backgroundColor: '#f59e0b' 
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false, 
      plugins: { legend: { display: false } }, 
      scales: { y: { beginAtZero: true, suggestedMax: aides.length > 0 ? undefined : 10 } } 
    }
  });
}

function displayAidCards(aides, page = 1) {
  const gridContainer = document.getElementById('funding-grid');
  if (!gridContainer) {
    console.error("Funding grid container not found!");
    return;
  }
  gridContainer.innerHTML = ""; 
  const itemsPerPage = 6; 
  const startIndex = (page - 1) * itemsPerPage;
  const allAides = aides || []; // Ensure allAides is an array
  const endIndex = Math.min(startIndex + itemsPerPage, allAides.length);
  const displayedAides = allAides.slice(startIndex, endIndex);
  
  if (allAides.length === 0) {
    gridContainer.innerHTML = '<div class="no-results" style="text-align:center; padding:2rem; color:var(--gray);">ZERO. NADA. RIEN. Aucune aide trouvée.</div>';
    const paginationEl = document.getElementById('pagination');
    if (paginationEl) paginationEl.innerHTML = ''; 
    return;
  }
  
  displayedAides.forEach(aide => {
    if (!aide) return; // Skip if aide is somehow null/undefined in the array
    const card = document.createElement('div');
    card.className = 'funding-card';
    card.dataset.id = aide.id_aid || `unknown-${Math.random()}`; 
    
    const effectifs = (typeof aide.effectif === 'string' ? aide.effectif : 'Non spécifié')
      .split(',')
      .map(eff => eff.trim())
      .map(eff => {
        if (eff === '-10') return 'Moins de 10 salariés';
        if (eff === '-5') return 'Moins de 5 salariés'; 
        return eff;
      })
      .join(', ');
      
    const ageEntreprise = (typeof aide.age_entreprise === 'string' ? aide.age_entreprise : 'Non spécifié');
    const categories = (typeof aide.id_domaine === 'string' ? aide.id_domaine : 'Non spécifié').split(',').map(cat => cat.trim()).join(', ');
    
    card.innerHTML = `
      <div class="funding-card-header">
        <h3 class="funding-card-title">${aide.aid_nom || 'Sans titre'}</h3>
        <div class="funding-card-subtitle">${(aide.couverture_geo || 'Non spécifié')} - ${categories}</div>
      </div>
      <div class="funding-card-body">
        <div class="funding-info-item">
          <div class="funding-info-label">Objectif</div>
          <div class="funding-info-value">${aide.aid_objet ? truncateText(aide.aid_objet, 150) : 'Non spécifié'}</div>
        </div>
        <div class="funding-info-item">
          <div class="funding-info-label">Bénéficiaires</div>
          <div class="funding-info-value">${aide.aid_benef ? truncateText(aide.aid_benef, 100) : 'Non spécifié'}</div>
        </div>
      </div>
      <div class="funding-card-footer">
        <div class="funding-tags">
          <div class="funding-tag">${effectifs}</div>
          <div class="funding-tag">${ageEntreprise}</div>
        </div>
        <button class="cta-button secondary view-details" data-id="${aide.id_aid || ''}">Voir les détails</button>
      </div>
    `;
    gridContainer.appendChild(card);
  });
  
  document.querySelectorAll('.view-details').forEach(button => {
    button.addEventListener('click', function() { 
      const aideId = this.getAttribute('data-id');
      if (!aideId) {
        console.warn("View details clicked on a card with no ID.");
        return;
      }
      const sourceAides = window.currentAides || [];
      const aide = sourceAides.find(a => a && a.id_aid === aideId); // Check if 'a' is defined
      if (aide) { showAideDetails(aide); }
      else { console.error("Aide non trouvée pour ID:", aideId, "Source (first 5):", sourceAides.slice(0,5)); } 
    });
  });
  
  createPagination(allAides.length, itemsPerPage, page);
}

function truncateText(text, maxLength) {
  if (typeof text !== 'string') return 'Non spécifié'; 
  return text.length <= maxLength ? text : text.substring(0, maxLength) + '...'; 
}

function createPagination(totalItems, itemsPerPage, currentPage) {
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const paginationContainer = document.getElementById('pagination');
  if (!paginationContainer) return;
  paginationContainer.innerHTML = "";
  
  if (totalPages <= 1) return; 
  
  const prevButton = document.createElement('button');
  prevButton.className = 'pagination-button';
  prevButton.innerHTML = '«'; 
  prevButton.disabled = currentPage === 1;
  prevButton.addEventListener('click', () => {
    if (currentPage > 1) {
      const filteredAides = getFilteredAides(window.currentAides || []); 
      displayAidCards(filteredAides, currentPage - 1);
    }
  });
  paginationContainer.appendChild(prevButton);
  
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  if (endPage - startPage + 1 < maxVisiblePages && totalPages >= maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  } else if (totalPages < maxVisiblePages) {
    startPage = 1;
    endPage = totalPages;
  }
  
  if (startPage > 1) {
    const firstButton = document.createElement('button');
    firstButton.className = 'pagination-button';
    firstButton.textContent = '1';
    firstButton.addEventListener('click', () => {
        const filteredAides = getFilteredAides(window.currentAides || []);
        displayAidCards(filteredAides, 1);
    });
    paginationContainer.appendChild(firstButton);
    if (startPage > 2) {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'pagination-ellipsis';
        ellipsis.textContent = '...';
        paginationContainer.appendChild(ellipsis);
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    const pageButton = document.createElement('button');
    pageButton.className = 'pagination-button';
    if (i === currentPage) pageButton.classList.add('active');
    pageButton.textContent = i;
    pageButton.addEventListener('click', () => {
      const filteredAides = getFilteredAides(window.currentAides || []);
      displayAidCards(filteredAides, i);
    });
    paginationContainer.appendChild(pageButton);
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'pagination-ellipsis';
        ellipsis.textContent = '...';
        paginationContainer.appendChild(ellipsis);
    }
    const lastButton = document.createElement('button');
    lastButton.className = 'pagination-button';
    lastButton.textContent = totalPages;
    lastButton.addEventListener('click', () => {
        const filteredAides = getFilteredAides(window.currentAides || []);
        displayAidCards(filteredAides, totalPages);
    });
    paginationContainer.appendChild(lastButton);
  }
  
  const nextButton = document.createElement('button');
  nextButton.className = 'pagination-button';
  nextButton.innerHTML = '»';
  nextButton.disabled = currentPage === totalPages;
  nextButton.addEventListener('click', () => {
    if (currentPage < totalPages) {
      const filteredAides = getFilteredAides(window.currentAides || []);
      displayAidCards(filteredAides, currentPage + 1);
    }
  });
  paginationContainer.appendChild(nextButton);
}

function initSearchAndFilters(aidesInput) {
  const aides = aidesInput || []; 
  const searchForm = document.getElementById('search-form');
  const applyFiltersBtn = document.getElementById('apply-filters');
  const resetFiltersBtn = document.getElementById('reset-filters');
  const categorySelect = document.getElementById('category');

  if(searchForm) {
    searchForm.addEventListener('submit', function(e) {
      e.preventDefault(); 
      const searchInput = document.getElementById('search-input');
      const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
      const filteredAides = getFilteredAides(window.currentAides || [], searchTerm); 
      displayAidCards(filteredAides, 1); 
    });
  }
  
  if(applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', function() {
      const searchInput = document.getElementById('search-input');
      const searchTerm = searchInput ? searchInput.value.toLowerCase() : ""; // Also consider search term with filters
      const filteredAides = getFilteredAides(window.currentAides || [], searchTerm); 
      displayAidCards(filteredAides, 1);
    });
  }
  
  if(resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', function() {
      const searchInput = document.getElementById('search-input');
      if(searchInput) searchInput.value = '';
      if(categorySelect) categorySelect.value = '';
      
      const companySizeSelect = document.getElementById('company-size');
      if(companySizeSelect) companySizeSelect.value = '';
      
      const companyAgeSelect = document.getElementById('company-age');
      if(companyAgeSelect) companyAgeSelect.value = '';
      
      const geographySelect = document.getElementById('geography');
      if(geographySelect) geographySelect.value = '';
      
      displayAidCards(window.currentAides || [], 1); 
    });
  }
  
  if(categorySelect) {
    const categories = new Set();
    if (aides.length > 0) {
      aides.forEach(aide => {
          if (aide && aide.id_domaine && typeof aide.id_domaine === 'string') {
            const cats = aide.id_domaine.split(',').map(cat => cat.trim());
            cats.forEach(cat => {
                if (cat) categories.add(cat);
            });
          }
      });
    }
    const sortedCategories = Array.from(categories).sort(); 
    
    // Clear existing options except the first "Toutes catégories"
    while (categorySelect.options.length > 1) {
      categorySelect.remove(1);
    }
    sortedCategories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      categorySelect.appendChild(option);
    });
  }
}

function getFilteredAides(allAidesInput, searchTerm = null) {
  const allAides = allAidesInput || []; 
  if (!Array.isArray(allAides)) {
    console.error("getFilteredAides received non-array input for allAides:", allAides);
    return []; 
  }
  
  const searchInputEl = document.getElementById('search-input');
  const categoryEl = document.getElementById('category');
  const companySizeEl = document.getElementById('company-size');
  const companyAgeEl = document.getElementById('company-age');
  const geographyEl = document.getElementById('geography');

  const currentSearchTerm = searchTerm !== null ? searchTerm : (searchInputEl ? searchInputEl.value.toLowerCase() : "");
  const category = categoryEl ? categoryEl.value : "";
  const companySize = companySizeEl ? companySizeEl.value : "";
  const companyAge = companyAgeEl ? companyAgeEl.value : "";
  const geography = geographyEl ? geographyEl.value : "";
  
  return allAides.filter(aide => {
    if (!aide) return false; // Skip if aide is null/undefined

    // Search term filter (checks multiple fields)
    if (currentSearchTerm) {
      const nameMatch = aide.aid_nom && typeof aide.aid_nom === 'string' && aide.aid_nom.toLowerCase().includes(currentSearchTerm);
      const objetMatch = aide.aid_objet && typeof aide.aid_objet === 'string' && aide.aid_objet.toLowerCase().includes(currentSearchTerm);
      const benefMatch = aide.aid_benef && typeof aide.aid_benef === 'string' && aide.aid_benef.toLowerCase().includes(currentSearchTerm);
      const domaineMatch = aide.id_domaine && typeof aide.id_domaine === 'string' && aide.id_domaine.toLowerCase().includes(currentSearchTerm);
      if (!nameMatch && !objetMatch && !benefMatch && !domaineMatch) return false;
    }
    
    // Category filter
    if (category) {
      if (!aide.id_domaine || typeof aide.id_domaine !== 'string' || !aide.id_domaine.split(',').map(cat => cat.trim()).includes(category)) return false;
    }
    
    // Company size filter
    if (companySize) { 
        const aideEffectif = (aide.effectif && typeof aide.effectif === 'string' ? aide.effectif : '').toLowerCase();
        let sizeMatch = false;
        if (!aideEffectif && companySize) return false; // If no effectif data but filter is set

        switch(companySize) {
            case "-10": sizeMatch = aideEffectif.includes('-10') || aideEffectif.includes('-5'); break;
            case "10-49": sizeMatch = aideEffectif.includes('10-49'); break;
            case "50-249": sizeMatch = aideEffectif.includes('50-249'); break;
            case "250 et plus": sizeMatch = aideEffectif.includes('250 et plus'); break;
            // Default case not needed as empty companySize means no filter
        }
        if (!sizeMatch) return false;
    }
    
    // Company age filter
    if (companyAge) {
      const aideAge = (aide.age_entreprise && typeof aide.age_entreprise === 'string' ? aide.age_entreprise : '');
      if (!aideAge.includes(companyAge)) return false;
    }

    // Geography filter
    if (geography) {
      if (aide.couverture_geo !== geography) return false;
    }
    
    return true; 
  });
}

function showAideDetails(aide) {
  if (!aide) {
    console.error("showAideDetails called with null/undefined aide.");
    return;
  }
  const modal = document.getElementById('detail-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalSubtitle = document.getElementById('modal-subtitle');
  const modalBody = document.getElementById('modal-body');

  if (!modal || !modalTitle || !modalSubtitle || !modalBody) {
    console.error("Modal elements not found!");
    return;
  }

  modalTitle.textContent = aide.aid_nom || 'Sans titre';
  const categories = (aide.id_domaine && typeof aide.id_domaine ==='string' ? aide.id_domaine : 'Non spécifié').split(',').map(cat => cat.trim()).join(', ');
  modalSubtitle.textContent = `${(aide.couverture_geo || 'Non spécifié')} - ${categories}`;
  
  let bodyContent = "";
  const addSection = (title, content) => {
    const currentContent = content && typeof content === 'string' ? content.trim() : '';
    if (currentContent) {
      bodyContent += `
        <div class="modal-section">
          <h3 class="modal-section-title">${title}</h3>
          <div class="modal-text">${currentContent}</div>
        </div>`;
    }
  };

  addSection('Objectif', aide.aid_objet);
  addSection('Opérations éligibles', aide.aid_operations_el);
  addSection('Conditions', aide.aid_conditions);
  addSection('Montant', aide.aid_montant);
  addSection('Bénéficiaires', aide.aid_benef);

  let complementInfo = `<p><strong>Taille d'entreprise :</strong> ${(aide.effectif || 'Non spécifié')}</p>
                        <p><strong>Âge d'entreprise :</strong> ${(aide.age_entreprise || 'Non spécifié')}</p>
                        <p><strong>Date de fin :</strong> ${(aide.aid_validation || 'Non spécifié')}</p>`;
  addSection('Informations complémentaires', complementInfo);
  
  let linksContent = "";
  if (aide.complements_sources && typeof aide.complements_sources === 'string') {
    linksContent += `<p><strong>Sources d'information :</strong> ${formatLinks(aide.complements_sources)}</p>`;
  }
  if (aide.complements_formulaires && typeof aide.complements_formulaires === 'string') {
    linksContent += `<p><strong>Formulaires de demande :</strong> ${formatLinks(aide.complements_formulaires)}</p>`;
  }
  if (linksContent) addSection('Liens utiles', linksContent);
  
  modalBody.innerHTML = bodyContent;
  modal.classList.add('open'); 
}

function formatLinks(text) {
  if (!text || typeof text !== 'string') return "";
  const urlRegex = /(https?:\/\/[^\s"<>]+)/g; 
  return text.replace(urlRegex, '<a href="$1" target="_blank" style="color:var(--primary); text-decoration:underline;">$1</a>');
}

function initModal() {
  const modal = document.getElementById('detail-modal');
  const modalContent = document.querySelector('.modal-content');
  const closeBtn = document.getElementById('modal-close');
  const closeBtnFooter = document.getElementById('modal-close-btn');
  
  if (!modal || !modalContent || !closeBtn || !closeBtnFooter) {
    console.warn("Modal elements missing, modal functionality might be impaired.");
    return;
  }
  
  const closeModal = () => modal.classList.remove('open');
  
  closeBtn.addEventListener('click', closeModal);
  closeBtnFooter.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { 
    if (e.target === modal) closeModal(); 
  });
  modalContent.addEventListener('click', (e) => e.stopPropagation());
}

document.addEventListener('DOMContentLoaded', function() {
  console.log("DOM LOADED. GITHUB PAGES CSV FILE PROTOCOL ENGAGED. FORTITUDE AND PERSEVERANCE!");
  initModal(); 
  
  const DATA_URL = "https://bros-ai.github.io/Aide-Financement-Entreprise/aides.csv"; 
  
  // Initialize UI elements with empty/default state before data loads
  updateStatistics([]);
  createCharts([]); // This will create charts with "No data" message
  displayAidCards([]); // This will show "No results" message
  initSearchAndFilters([]); // Initialize filters, category dropdown will be empty until data loads

  loadDataFromURLManualFetch(DATA_URL)
    .then(() => {
      // This .then() might not be reached if loadDataFromURLManualFetch doesn't return a promise
      // or if an error inside PapaParse's async callbacks isn't bubbled up.
      // The logic for updating UI after data load is already in Papa.complete.
      console.log("Initial data load attempt finished (async).");
    })
    .catch(error => {
      // This .catch() will primarily catch errors from the fetch() promise itself,
      // or if an error is explicitly re-thrown from PapaParse callbacks and bubbled up.
      console.error("Error during loadDataFromURLManualFetch promise chain:", error);
    });
});
