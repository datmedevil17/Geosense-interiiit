import React, { useEffect } from 'react';
import { MapContainer, TileLayer, FeatureGroup, LayersControl, GeoJSON } from 'react-leaflet';
import { EditControl } from "react-leaflet-draw";
import 'leaflet/dist/leaflet.css';
import { DEFAULT_POSITION } from '@/config/mapConfig';
import TextInput from '@/components/shared/TextInput';
import SearchControl from '@/components/shared/SearchControl'; // <-- 1. This line is now fixed

const { BaseLayer, Overlay } = LayersControl;

// Initialize global variable type
window.type = '';

/************************************************************
 * Main Map Component
 ************************************************************/

const MapComponent = ({ textMode, editDetails, features, setFeatures, setSelectionHandlers }) => {
    const [isOpen, setIsOpen] = React.useState(false);                  // text input modal
    const [selectedLayer, setSelectedLayer] = React.useState({});       // selected feature
    const [segmentationData, setSegmentationData] = React.useState(null);
    const [selectedPolygons, setSelectedPolygons] = React.useState(new Set());
    const [hoveredPolygon, setHoveredPolygon] = React.useState(null);
    const [geoJSONLayer, setGeoJSONLayer] = React.useState(null);
    L.Icon.Default.imagePath = '/images/';

    // bind the text to the selected feature, then push it to the properties field so we could use toGeoJSON() to get the feature
    const onSubmitText = (data) => {
        let popupContent = getPopupContent(data.text);

        if (!selectedLayer) return;
        selectedLayer.bindPopup(popupContent).openPopup();      // get the selected feature, add the text and update the state
        setFeatures(prevFeatures => {                           // find the feature that has the same _leaflet_id as the selectedLayer
            let updatedFeatures = prevFeatures.map(feat => {
                // add or update the text property
                if (feat._leaflet_id === selectedLayer._leaflet_id) {
                    if (!feat.feature) feat.feature = { type: 'Feature', properties: { text: popupContent } };
                    else feat.feature.properties.text = popupContent;
                }
                return feat;
            });
            return updatedFeatures;
        });
        setSelectedLayer({});                                   // clear the selected layer
        setIsOpen(false);
    }
    

    const getPopupContent = (text) => { 
        if (!text) return '';
        let popupContent = '';                                  // extract lines
        let lastLine = text.split('\n').pop();                  // add line breaks if not the last line
        for (let line of text.split('\n')) {
            popupContent += `${line}` + (line !== lastLine ? '<br>' : '');
        }
        return popupContent;
    }

    /************************************************************
     * Function to edit text without triggering leaflet-draw
     ************************************************************/

    useEffect(() => {
        onEdit(editDetails);
    }, [editDetails]);

    const onEdit = (editDetails) => {
        const { id, newText } = editDetails;
        let popupContent = getPopupContent(newText);

        setFeatures(prevFeatures => {
            let updatedFeatures = prevFeatures.map(feat => {
                if (feat._leaflet_id === id) {
                    if (!feat.feature) {
                        feat.feature = { type: 'Feature', properties: { text: newText } };
                    }
                    else feat.feature.properties.text = newText;
                    // update the popup
                    feat.bindPopup(popupContent).openPopup();
                }
                return feat;
            });
            return updatedFeatures;
        });
        setIsOpen(false);
    }

    /************************************************************
     * Functions to handle react-leaflet-draw events
     ************************************************************/
    const _onCreated = (e) => {
        const { layer } = e;
        setSelectedLayer(layer);            // Store the selected layer
        setIsOpen(true);
        setFeatures(prevFeatures => [...prevFeatures, layer]);
    };

    const _onEdited = (e) => {
        const { layers } = e;

        layers.eachLayer((layer) => {
            setSelectedLayer(layer); // Store the selected layer
            setFeatures(prevFeatures => prevFeatures.map(feat =>
                feat._leaflet_id === layer._leaflet_id ? layer : feat
            ));
        });
        setIsOpen(true);
    };

    const _onDeleted = (e) => {
        const { layers } = e;
        layers.eachLayer((layer) => {
            setFeatures(prevFeatures => prevFeatures.filter(feat => feat._leaflet_id !== layer._leaflet_id));
        });
    };

    // Fetch segmentation data
    const fetchSegmentationData = async () => {
        try {
            console.log("Fetching segmentation data...");
            const response = await fetch('http://127.0.0.1:5010/get-segments');
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'success') {
                    console.log("Segmentation data received");
                    const parsedData = JSON.parse(data.data);
                    setSegmentationData(parsedData);
                    console.log("Segmentation data set:", parsedData);
                }
            }
        } catch (error) {
            console.error('Error fetching segmentation data:', error);
        }
    };

    // Expose fetchSegmentationData to window object
    React.useEffect(() => {
        if (document.querySelector('#map-container')) {
            document.querySelector('#map-container').fetchSegmentationData = fetchSegmentationData;
        }
    }, []);

    // Style for unselected polygons
    const defaultStyle = {
        fillColor: '#ff7800',
        weight: 2,
        opacity: 1,
        color: '#ff7800',
        fillOpacity: 0.4
    };

    // Style for selected polygons
    const selectedStyle = {
        fillColor: '#00ff00',
        weight: 3,
        opacity: 1,
        color: '#00ff00',
        fillOpacity: 0.6
    };

    // Style for hovered polygons
    const hoveredStyle = {
        fillColor: '#0000ff',
        weight: 3,
        opacity: 1,
        color: '#0000ff',
        fillOpacity: 0.6
    };

    // Function to handle polygon click
    const onEachFeature = (feature, layer) => {
        layer.feature = feature;
        
        // Bind a tooltip to show the segment ID on hover
        if (feature.properties && feature.properties.segment_id) {
            layer.bindTooltip(`Segment ID: ${feature.properties.segment_id}`, {
                permanent: false,
                direction: "auto",
                sticky: true
            });
        }
    
        layer.on({
            click: (e) => {
                const featureId = feature.properties.segment_id;
    
                setSelectedPolygons(prev => {
                    const newSelected = new Set([...prev]);
                    if (newSelected.has(featureId)) {
                        newSelected.delete(featureId);
                    } else {
                        newSelected.add(featureId);
                    }
                    return newSelected;
                });
    
                L.DomEvent.stopPropagation(e);
            },
            mouseover: (e) => {
                const layer = e.target;
                setHoveredPolygon(layer.feature.properties.segment_id);
                layer.setStyle(hoveredStyle);
            },
            mouseout: (e) => {
                const layer = e.target;
                const featureId = layer.feature.properties.segment_id;
                setHoveredPolygon(null);
                layer.setStyle(
                    selectedPolygons.has(featureId) ? selectedStyle : defaultStyle
                );
            }
        });
    };
    

    // Function to select all polygons
    const selectAllPolygons = () => {
        if (segmentationData) {
            const allIds = new Set(segmentationData.features.map(f => f.properties.segment_id));
            setSelectedPolygons(allIds);
        }
    };

    // Function to deselect all polygons
    const deselectAllPolygons = () => {
        setSelectedPolygons(new Set());
    };

    // Effect to ensure styles are consistent with selection state
    React.useEffect(() => {
        if (geoJSONLayer && segmentationData) {
            geoJSONLayer.eachLayer(layer => {
                const featureId = layer.feature.properties.segment_id;
                layer.setStyle(
                    selectedPolygons.has(featureId) ? selectedStyle : defaultStyle
                );
            });
        }
    }, [selectedPolygons, geoJSONLayer, segmentationData]);

    // Add this function to get feature by ID
    const getFeatureById = (id) => {
        if (!segmentationData) return null;
        return segmentationData.features.find(f => f.properties.segment_id === id);
    };

    // Update the useEffect that sets selection handlers
    React.useEffect(() => {
        setSelectionHandlers({
            selectAllPolygons,
            deselectAllPolygons,
            getSelectedPolygons: () => selectedPolygons,
            getFeatureById  // Add this
        });
    }, [segmentationData, geoJSONLayer, selectedPolygons]);

    /************************************************************
     * RENDERING
     ************************************************************/

    return (
        <section id="map-container">
            <MapContainer
                center={DEFAULT_POSITION}
                zoom={8}
                style={{ height: '100vh', width: '100%' }}
            >
                <SearchControl /> {/* <-- 2. This is correctly placed */}

                <LayersControl position="topleft">
                    <BaseLayer checked name="Google Satellite">
                        <TileLayer
                            attribution='© Google'
                            url='https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
                        />
                    </BaseLayer>
                    <BaseLayer name="OpenStreetMap">
                        <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
                        />
                    </BaseLayer>

                    {/* Add Segmentation Layer */}
                    <Overlay checked name="Segmentation">
                        {segmentationData && (
                            <GeoJSON 
                                key={JSON.stringify(segmentationData)}
                                data={segmentationData} 
                                style={(feature) => 
                                    selectedPolygons.has(feature.properties.segment_id) 
                                        ? selectedStyle 
                                        : defaultStyle
                                }
                                onEachFeature={onEachFeature}
                                ref={setGeoJSONLayer}
                            />
                        )}
                    </Overlay>
                </LayersControl>

                {/* Draw Control & Features */}
                <FeatureGroup>
                    <EditControl
                        textMode={textMode}
                        position="bottomleft"
                        onEdited={_onEdited}
                        onCreated={(e) => {
                            _onCreated(e);
                            // Reset segmentation data when new feature is created
                            setSegmentationData(null);
                        }}
                        onDeleted={_onDeleted}
                        draw={{
                            rectangle: true,
                            circle: false,
                            circlemarker: false,
                            marker: false,
                            polyline: false,
                            polygon: false,
                        }}
                    />
                </FeatureGroup>
            </MapContainer>

            <TextInput 
                textMode={textMode} 
                featureText={selectedLayer.feature?.properties?.text}
                onSubmitText={onSubmitText}
                isOpen={isOpen}
                setIsOpen={setIsOpen}
                onSegmentationComplete={fetchSegmentationData}
            />

            {/* Selected polygons counter */}
            {selectedPolygons.size > 0 && (
                <div style={{
                    position: 'absolute',
                    bottom: '20px',
                    right: '420px',
                    backgroundColor: 'white',
                    padding: '10px',
                    borderRadius: '5px',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                    zIndex: 1000
                }}>
                    Selected Polygons: {selectedPolygons.size}
                </div>
            )}
        </section>
    );
}

export default MapComponent;