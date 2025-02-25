// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoiamVmZi0yMDI1IiwiYSI6ImNtN2ZteDA4ajByNDQya29vOXkxZnNwNHcifQ.PKJgvtQTkgPz4cgAG4LdEQ';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

// Define bike lane style
const bikeLaneStyle = {
  'line-color': '#32D400',
  'line-width': 5,
  'line-opacity': 0.6
};

// Select the SVG element
const svg = d3.select('#map').select('svg');

// Quantized scale for traffic flow
const stationFlow = d3.scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);

// Slider setup
let timeFilter = -1;
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function updateTimeDisplay(trips, stations, circles) {
  timeFilter = Number(timeSlider.value);
  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range(timeFilter === -1 ? [0, 25] : [3, 50]);

  let filteredTrips;
  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'block';
    filteredTrips = trips;
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
    filteredTrips = trips.filter(trip => {
      const startedMinutes = minutesSinceMidnight(trip.started_at);
      const endedMinutes = minutesSinceMidnight(trip.ended_at);
      return (
        Math.abs(startedMinutes - timeFilter) <= 60 ||
        Math.abs(endedMinutes - timeFilter) <= 60
      );
    });
  }

  const filteredDepartures = d3.rollup(
    filteredTrips,
    v => v.length,
    d => d.start_station_id
  );
  const filteredArrivals = d3.rollup(
    filteredTrips,
    v => v.length,
    d => d.end_station_id
  );

  const filteredStations = stations.map(station => {
    const clonedStation = { ...station };
    const id = clonedStation.short_name;
    clonedStation.arrivals = filteredArrivals.get(id) || 0;
    clonedStation.departures = filteredDepartures.get(id) || 0;
    clonedStation.totalTraffic = clonedStation.arrivals + clonedStation.departures;
    return clonedStation;
  });

  circles.data(filteredStations)
    .attr('r', d => radiusScale(d.totalTraffic))
    .style('--departure-ratio', d => stationFlow(d.departures / d.totalTraffic));
}

// Wait for the map to load before adding data
map.on('load', () => {
  // Add Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?outSR=%7B%22latestWkid%22%3A3857%2C%22wkid%22%3A102100%7D'
  });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle
  });

  // Add Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://data.cambridgema.gov/api/geospatial/3kjd-bnjh?method=export&format=GeoJSON'
  });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle
  });

  // Load station and traffic data
  Promise.all([
    d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json'),
    d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv')
  ]).then(([stationData, tripData]) => {
    const stations = stationData.data.stations;
    const trips = tripData.map(trip => ({
      ...trip,
      started_at: new Date(trip.started_at),
      ended_at: new Date(trip.ended_at)
    }));

    // Initial traffic calculation
    const departures = d3.rollup(trips, v => v.length, d => d.start_station_id);
    const arrivals = d3.rollup(trips, v => v.length, d => d.end_station_id);
    stations.forEach(station => {
      const id = station.short_name;
      station.arrivals = arrivals.get(id) || 0;
      station.departures = departures.get(id) || 0;
      station.totalTraffic = station.arrivals + station.departures;
    });

    // Create circles
    const circles = svg.selectAll('circle')
      .data(stations)
      .enter()
      .append('circle')
      .each(function(d) {
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });

    // Positioning functions
    function getCoords(station) {
      const point = new mapboxgl.LngLat(+station.lon, +station.lat);
      const { x, y } = map.project(point);
      return { cx: x, cy: y };
    }

    function updatePositions() {
      circles
        .attr('cx', d => getCoords(d).cx)
        .attr('cy', d => getCoords(d).cy);
    }

    // Initial updates
    updatePositions();
    updateTimeDisplay(trips, stations, circles);

    // Event listeners
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);
    timeSlider.addEventListener('input', () => updateTimeDisplay(trips, stations, circles));
  }).catch(error => {
    console.error('Error loading data:', error);
  });
});