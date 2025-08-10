document.addEventListener('DOMContentLoaded', () => {
  // --- GLOBAL VARIABLES ---
  let analyticsChart = null;
  let historicalData = [];
  const MAX_HISTORICAL_DATA_POINTS = 200;
  const MAX_CHART_POINTS = 50;
  let map, marker;

  // --- THEME SWITCHER LOGIC ---
  const themeSwitcherBtn = document.getElementById('theme-switcher-btn');
  themeSwitcherBtn.addEventListener('click', (event) => {
    const currentTheme = document.body.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme, event);
  });

  function setTheme(themeId, event) {
    if (event && document.startViewTransition) {
      const x = event.clientX; const y = event.clientY;
      document.documentElement.style.setProperty('--ripple-x', x + 'px');
      document.documentElement.style.setProperty('--ripple-y', y + 'px');
      document.startViewTransition(() => { document.body.setAttribute('data-theme', themeId); });
    } else { document.body.setAttribute('data-theme', themeId); }
    
    localStorage.setItem('theme', themeId);

    if (themeId === 'dark') {
      themeSwitcherBtn.innerHTML = '<i class="fas fa-sun"></i>';
    } else {
      themeSwitcherBtn.innerHTML = '<i class="fas fa-moon"></i>';
    }

    if (analyticsChart) { renderAnalyticsChart(); }
  }

  // --- TAB SWITCHING LOGIC ---
  const tabs = {
    gauge: { btn: document.getElementById('tab-gauge'), content: document.getElementById('tab-content-gauge') },
    analytics: { btn: document.getElementById('tab-analytics'), content: document.getElementById('tab-content-analytics') }
  };

  Object.keys(tabs).forEach(key => {
    tabs[key].btn.addEventListener('click', () => {
      Object.values(tabs).forEach(t => { 
        t.btn.classList.remove('tab-active'); 
        t.content.classList.add('hidden'); 
      });
      tabs[key].btn.classList.add('tab-active');
      tabs[key].content.classList.remove('hidden');

      if (key === 'analytics') {
        renderAnalyticsChart();
      }
    });
  });

  // --- LOCATION FUNCTIONS ---
  async function getAddressFromCoords(lat, lng) {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
        headers: {
          'User-Agent': 'SmartCityDashboard/1.0'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Geocoding failed with status ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.address) {
        // Construct address from available components
        const addressParts = [
          data.address.road,
          data.address.village || data.address.town || data.address.city,
          data.address.state,
          data.address.country
        ].filter(Boolean);
        
        return addressParts.join(', ') || "Unknown Location";
      }
      return "Unknown Location";
    } catch (error) {
      console.error("Geocoding error:", error);
      return "Location coordinates: " + lat.toFixed(4) + ", " + lng.toFixed(4);
    }
  }

  function initializeMap(lat, lng) {
    map = L.map('map').setView([lat, lng], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    marker = L.marker([lat, lng]).addTo(map);
    return marker;
  }

  // --- LIVE DATA FETCHING ---
  async function fetchData() {
    try {
      const response = await fetch('https://gas-value-33f5a-default-rtdb.firebaseio.com/SensorData.json');
      
      if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.statusText}`);
      }
      
      const liveData = await response.json();
      
      if (liveData && liveData.location) {
        const [lat, lng] = liveData.location.split(',').map(Number);
        
        // Initialize map if not already done
        if (!map) {
          marker = initializeMap(lat, lng);
        }
        
        // Get address from coordinates
        const address = await getAddressFromCoords(lat, lng);
        
        const formattedData = {
          temperature: liveData.temperature,
          humidity: liveData.humidity,
          carbon: liveData.carbon,
          latitude: lat,
          longitude: lng,
          predictedCarbon: liveData.carbon * 1.05,
          locationName: address,
          timestamp: liveData.timestamp
        };

        updateDashboard(formattedData);
        
        // Add new data to historical array
        historicalData.push(formattedData);
        
        // Keep only the last MAX_HISTORICAL_DATA_POINTS data points
        if (historicalData.length > MAX_HISTORICAL_DATA_POINTS) {
          historicalData = historicalData.slice(-MAX_HISTORICAL_DATA_POINTS);
        }
        
        if (!tabs.analytics.content.classList.contains('hidden')) {
          renderAnalyticsChart();
        }
      }
    } catch (error) {
      console.error("Failed to fetch live data:", error);
      document.getElementById("locationName").textContent = "Error loading location data";
      document.getElementById("locationVal").textContent = "--, --";
    }
  }

  // --- GAUGE & DASHBOARD UPDATE LOGIC ---
  function updateGauge(fillId, coverId, value, max, unit) {
    const fillEl = document.getElementById(fillId);
    const coverEl = document.getElementById(coverId);
    if (!fillEl || !coverEl) return;
    const percentage = Math.max(0, Math.min(1, value / max));
    const rotation = percentage / 2;
    fillEl.style.transform = `rotate(${rotation}turn)`;
    coverEl.innerHTML = `${value.toFixed(0)}<span>${unit}</span>`;
  }
  
  function updateDashboard(data) {
    const date = new Date(data.timestamp);
    document.getElementById("lastUpdated").textContent = date.toLocaleTimeString('en-US');
    
    updateGauge('temp-gauge-fill', 'temp-gauge-cover', data.temperature, 50, '°C');
    updateGauge('humidity-gauge-fill', 'humidity-gauge-cover', data.humidity, 100, '%');
    updateGauge('carbon-gauge-fill', 'carbon-gauge-cover', data.carbon, 1000, 'ppm');
    updateGauge('prediction-gauge-fill', 'prediction-gauge-cover', data.predictedCarbon, 1000, 'ppm');
    
    document.getElementById("locationVal").textContent = `${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}`;
    document.getElementById("locationName").textContent = data.locationName;
    
    // Update map marker and recenter
    marker.setLatLng([data.latitude, data.longitude]);
    map.setView([data.latitude, data.longitude], 12);
    marker.bindPopup(`<b>${data.locationName}</b><br>Temp: ${data.temperature.toFixed(1)}°C`);
  }

  // --- ANALYTICS CHART LOGIC ---
  const chartCanvas = document.getElementById('analytics-chart');
  const chartTimeFilter = document.getElementById('chart-time-filter');
  const chartDataFilter = document.getElementById('chart-data-filter');
  
  function renderAnalyticsChart() {
    if (historicalData.length === 0) return;
    if (analyticsChart) { analyticsChart.destroy(); }
    
    // Filter data based on time selection
    const timeFilter = chartTimeFilter.value;
    const now = new Date();
    let filteredData = [...historicalData];
    
    if (timeFilter === '24h') {
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      filteredData = historicalData.filter(d => new Date(d.timestamp) > oneDayAgo);
    } else if (timeFilter === '7d') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      filteredData = historicalData.filter(d => new Date(d.timestamp) > sevenDaysAgo);
    }
    
    // Limit to MAX_CHART_POINTS data points for better performance
    if (filteredData.length > MAX_CHART_POINTS) {
      const step = Math.floor(filteredData.length / MAX_CHART_POINTS);
      filteredData = filteredData.filter((_, index) => index % step === 0);
    }
    
    const theme = document.body.getAttribute('data-theme') || 'light';
    const gridColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const fontColor = theme === 'dark' ? '#f9fafb' : '#1f2937';
    
    const selectedDataKey = chartDataFilter.value;
    const labels = filteredData.map(d => new Date(d.timestamp));
    const dataPoints = filteredData.map(d => d[selectedDataKey]);

    analyticsChart = new Chart(chartCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: chartDataFilter.options[chartDataFilter.selectedIndex].text,
          data: dataPoints,
          borderColor: 'var(--color-primary)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true, 
          tension: 0.3, 
          pointRadius: 3,
          pointBackgroundColor: 'var(--color-primary)',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: {
              unit: timeFilter === '24h' ? 'hour' : 'day',
              displayFormats: {
                hour: 'HH:mm',
                day: 'MMM d'
              }
            },
            grid: { color: gridColor },
            ticks: { color: fontColor }
          },
          y: {
            beginAtZero: false,
            grid: { color: gridColor },
            ticks: { color: fontColor }
          }
        },
        plugins: { 
          legend: { 
            labels: { 
              color: fontColor,
              boxWidth: 12,
              padding: 20
            } 
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: theme === 'dark' ? '#1f2937' : '#ffffff',
            titleColor: fontColor,
            bodyColor: fontColor,
            borderColor: gridColor,
            borderWidth: 1
          }
        },
        animation: { duration: 0 }
      }
    });
  }
  
  chartTimeFilter.addEventListener('change', renderAnalyticsChart);
  chartDataFilter.addEventListener('change', renderAnalyticsChart);
  
  // --- INITIALIZATION ---
  const savedTheme = localStorage.getItem('theme') || 'light';
  setTheme(savedTheme); 

  // Initial fetch
  fetchData();
  // Then fetch every second
  setInterval(fetchData, 1000);
});