
"use client";

interface StaticMapProps {
    location: { lat: number; lng: number };
}

const StaticMap = ({ location }: StaticMapProps) => {
    if (!location) {
        return (
            <div className="flex items-center justify-center w-full h-full bg-muted text-muted-foreground">
                <p>Ubicación no proporcionada.</p>
            </div>
        );
    }
    
    const { lat, lng } = location;
    
    // The bounding box values determine the zoom level.
    // Smaller values result in a closer zoom.
    const delta = 0.002;
    const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;

    // Use OpenStreetMap's embeddable iframe URL generator.
    const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
    
    return (
        <div className="relative w-full h-full">
            <iframe
                width="100%"
                height="100%"
                frameBorder="0"
                scrolling="no"
                marginHeight={0}
                marginWidth={0}
                src={mapUrl}
                style={{ border: 'none' }}
                title="Mapa de la ubicación"
                data-ai-hint="map location"
            ></iframe>
        </div>
    );
};

export default StaticMap;
