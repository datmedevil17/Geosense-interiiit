from flask import Flask, request, jsonify
from flask_cors import CORS
import logging
import os
import sys
import traceback
import geopandas as gpd
from pyproj import Transformer
from shapely.ops import transform
import pyproj
import numpy as np

# Add parent directory to path to import local modules
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from create_shapefile import create_bbox_shapefile
from download_imagery import download_satellite_imagery
from segment_land_hqsam import segment_satellite_image
from qgis.core import QgsApplication

app = Flask(__name__)
CORS(app)

log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

# Initialize QGIS Application
qgs = QgsApplication([], False)
qgs.initQgis()

@app.route('/')
def index():
    return 'Hello World'

@app.route('/minmax', methods=['POST'])
def minmax():
    try:
        data = request.get_json()
        min_coords = data.get('min')  # [lat, lon]
        max_coords = data.get('max')  # [lat, lon]
        
        print(f'Received Min: {min_coords}, Max: {max_coords}')
        
        # Reformat coordinates for shapefile creation [min_lon, min_lat, max_lon, max_lat]
        bbox_coords = [min_coords[1], min_coords[0], max_coords[1], max_coords[0]]
        
        # Create temporary shapefile
        temp_shapefile = create_bbox_shapefile(bbox_coords, "temp_region")
        
        # Create output directory for imagery
        output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'temp', 'imagery')
        os.makedirs(output_dir, exist_ok=True)
        
        # Download imagery using the temporary shapefile
        output_image = os.path.join(output_dir, 'temp_satellite.tif')
        result = download_satellite_imagery(qgs, temp_shapefile, output_image)
        
        if result['success']:
            print("\nComplete workflow status:")
            print("✓ Shapefile created")
            print("✓ Satellite imagery downloaded")
            print("✓ Starting segmentation...")
            
            # Perform segmentation
            seg_result = segment_satellite_image()
            
            if seg_result:
                print("✓ Segmentation completed successfully")
                return jsonify({
                    'status': 'success',
                    'shapefile': temp_shapefile,
                    'imagery': output_image,
                    'message': 'Workflow completed successfully'
                }), 200
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'Segmentation failed'
                }), 500
        else:
            return jsonify({
                'status': 'error',
                'message': result['error']
            }), 500
            
    except Exception as e:
        print(f"Error in /minmax endpoint: {str(e)}")
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/get-segments', methods=['GET'])
def get_segments():
    try:
        shapefile_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 
                                    'temp', 'segmentation', 'temp_polygons.shp')
        
        if not os.path.exists(shapefile_path):
            return jsonify({
                'status': 'error',
                'message': 'Segmentation shapefile not found'
            }), 404
            
        # Read shapefile in WGS84
        gdf = gpd.read_file(shapefile_path)
        
        # Convert to WGS84 if not already
        if gdf.crs is None or gdf.crs.to_string() != 'EPSG:4326':
            gdf = gdf.to_crs('EPSG:4326')
        
        # Calculate areas using geodesic method
        geod = pyproj.Geod(ellps='WGS84')
        
        # Calculate area for each polygon
        def calculate_area(geometry):
            try:
                area = abs(geod.geometry_area_perimeter(geometry)[0])
                return round(float(area), 2)
            except Exception as e:
                print(f"Error calculating area: {e}")
                return 0
        
        # Add area to properties
        gdf['area_m2'] = gdf.geometry.apply(calculate_area)
        
        # Convert to GeoJSON
        geojson_data = gdf.to_json()
        
        print("Successfully processed shapefile with areas")
        return jsonify({
            'status': 'success',
            'data': geojson_data
        })
        
    except Exception as e:
        print(f"Error in get_segments: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/calculate-areas', methods=['POST'])
def calculate_areas():
    try:
        data = request.get_json()
        selected_ids = data.get('selectedIds', [])
        
        shapefile_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 
                                    'temp', 'segmentation', 'temp_polygons.shp')
        
        if not os.path.exists(shapefile_path):
            return jsonify({
                'status': 'error',
                'message': 'Shapefile not found'
            }), 404
            
        # Read the shapefile
        gdf = gpd.read_file(shapefile_path)
        
        # Calculate areas for selected polygons
        areas = {}
        for idx in selected_ids:
            try:
                segment_id = int(idx) if isinstance(idx, str) else idx
                polygon_row = gdf[gdf['segment_id'] == segment_id]
                
                if not polygon_row.empty:
                    # Get the polygon
                    polygon = polygon_row.geometry.iloc[0]
                    
                    # Print coordinates for debugging
                    print(f"Polygon {segment_id} bounds:", polygon.bounds)
                    
                    # Calculate area using geodesic calculations
                    geod = pyproj.Geod(ellps='WGS84')
                    area = abs(geod.geometry_area_perimeter(polygon)[0])
                    
                    print(f"Polygon {segment_id} area: {area} m²")
                    areas[str(segment_id)] = round(float(area), 2)
                else:
                    print(f"Polygon with segment_id {segment_id} not found")
                    areas[str(segment_id)] = 0
                    
            except Exception as e:
                print(f"Error processing polygon {idx}: {str(e)}")
                areas[str(idx)] = 0
        
        print("Calculated areas:", areas)
        
        return jsonify({
            'status': 'success',
            'areas': areas
        })
        
    except Exception as e:
        print(f"Error in calculate_areas: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST')
    return response

if __name__ == '__main__':
    host = '127.0.0.1'
    port = 5010
    print(f'Server running on http://{host}:{port}')
    app.run(debug=True, host=host, port=port)