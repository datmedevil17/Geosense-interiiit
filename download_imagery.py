import os
from qgis.core import (
    QgsVectorLayer,
    QgsRasterLayer,
    QgsProject,
    QgsMapSettings,
    QgsMapRendererSequentialJob,
    QgsCoordinateReferenceSystem,
    QgsRectangle
)
from qgis.PyQt.QtCore import QSize
import requests
from osgeo import gdal, osr

def download_satellite_imagery(qgs_app, image_path, output_path, resolution=4096):
    """
    Download Google Satellite imagery using QGIS rendering engine
    
    Args:
        qgs_app: QgsApplication instance
        image_path: Path to input shapefile
        output_path: Path to save the output image
        resolution: Width of the output image in pixels
    """
    try:
        print(f"Loading shapefile: {image_path}")
        vector_layer = QgsVectorLayer(image_path, "bbox", "ogr")
        if not vector_layer.isValid():
            raise Exception("Failed to load shapefile")

        # Get extent
        extent = vector_layer.extent()
        
        # Calculate dimensions
        width = resolution
        height = int(width * extent.height() / extent.width())
        
        print(f"Image dimensions: {width}x{height}")

        # Setup Google Satellite layer
        xyz_url = 'type=xyz&url=https://mt1.google.com/vt/lyrs%3Ds%26x%3D%7Bx%7D%26y%3D%7By%7D%26z%3D%7Bz%7D&zmax=20&zmin=0'
        satellite = QgsRasterLayer(xyz_url, 'Google Satellite', 'wms')
        
        if not satellite.isValid():
            raise Exception("Failed to load Google Satellite layer")

        # Setup the map settings
        ms = QgsMapSettings()
        ms.setLayers([satellite])
        ms.setDestinationCrs(QgsCoordinateReferenceSystem('EPSG:3857'))
        ms.setOutputSize(QSize(width, height))
        ms.setExtent(extent)

        # Render the map
        print("Rendering high-resolution satellite imagery...")
        render = QgsMapRendererSequentialJob(ms)
        render.start()
        render.waitForFinished()

        # Get the rendered image
        img = render.renderedImage()
        
        # Save as temporary file
        temp_path = output_path + "_temp.png"
        img.save(temp_path, "PNG")

        print("Creating GeoTIFF with metadata...")
        # Create GeoTIFF with GDAL
        driver = gdal.GetDriverByName('GTiff')
        dataset = driver.Create(
            output_path,
            width,
            height,
            3,
            gdal.GDT_Byte,
            options=['COMPRESS=JPEG', 'JPEG_QUALITY=95', 'TILED=YES']
        )

        # Set spatial reference
        srs = osr.SpatialReference()
        srs.ImportFromEPSG(3857)
        dataset.SetProjection(srs.ExportToWkt())

        # Calculate and set geotransform
        pixel_width = extent.width() / width
        pixel_height = extent.height() / height
        geotransform = [
            extent.xMinimum(),
            pixel_width,
            0,
            extent.yMaximum(),
            0,
            -pixel_height
        ]
        dataset.SetGeoTransform(geotransform)

        # Read temporary image and write to GeoTIFF
        temp_ds = gdal.Open(temp_path)
        if temp_ds:
            for band in range(1, 4):
                src_band = temp_ds.GetRasterBand(band)
                dst_band = dataset.GetRasterBand(band)
                dst_band.WriteArray(src_band.ReadAsArray())

        # Clean up (keep temp PNG for segmentation script)
        dataset = None
        temp_ds = None
        # Note: Don't delete temp_path - segmentation script needs it
        # os.remove(temp_path)
        QgsProject.instance().removeAllMapLayers()

        print(f"High-resolution GeoTIFF saved successfully: {output_path}")
        print(f"Resolution: {pixel_width:.2f} meters/pixel")

        return {
            'success': True,
            'image_path': output_path
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return {
            'success': False,
            'error': str(e)
        }