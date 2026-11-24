"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Search, Loader2, MapPin, Navigation, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { searchAddress, reverseGeocode, GeocodedAddress, GeocodingSearchResult } from '@/services/geocoding';

// Fix for default icon issue with webpack / Next.js
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon.src,
    shadowUrl: iconShadow.src,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
});

L.Marker.prototype.options.icon = DefaultIcon;

interface InteractiveMapProps {
    initialPosition?: { lat: number; lng: number };
    onLocationSelect: (location: { lat: number; lng: number }) => void;
    onAddressSelect?: (address: GeocodedAddress) => void;
    showSearch?: boolean;
    height?: string;
}

const MapEvents = ({
    onLocationSelect,
    onAddressSelect,
    setMarkerPosition,
}: { 
    onLocationSelect: (location: { lat: number; lng: number }) => void;
    onAddressSelect?: (address: GeocodedAddress) => void;
    setMarkerPosition: (position: L.LatLng) => void;
}) => {
    useMapEvents({
        async click(e) {
            const { lat, lng } = e.latlng;
            setMarkerPosition(e.latlng);
            onLocationSelect({ lat, lng });

            if (onAddressSelect) {
                const address = await reverseGeocode(lat, lng);
                if (address) {
                    onAddressSelect(address);
                }
            }
        },
    });
    return null;
};

const ChangeView = ({ center, zoom }: { center: [number, number]; zoom: number }) => {
    const map = useMap();
    useEffect(() => {
        map.setView(center, zoom);
    }, [center, zoom, map]);
    return null;
};

const InteractiveMap = ({
    initialPosition,
    onLocationSelect,
    onAddressSelect,
    showSearch = true,
    height = '100%',
}: InteractiveMapProps) => {
    const defaultCenter: [number, number] = [-34.6037, -58.3816]; // Buenos Aires
    const [position, setPosition] = useState<[number, number]>(
        initialPosition ? [initialPosition.lat, initialPosition.lng] : defaultCenter
    );
    const [markerPosition, setMarkerPosition] = useState<L.LatLng | null>(
        initialPosition ? L.latLng(initialPosition.lat, initialPosition.lng) : null
    );

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<GeocodingSearchResult[]>([]);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isLocating, setIsLocating] = useState(false);
    const [selectedAddressText, setSelectedAddressText] = useState<string>('');
    const searchRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (initialPosition && initialPosition.lat && initialPosition.lng) {
            const latLng = L.latLng(initialPosition.lat, initialPosition.lng);
            setPosition([initialPosition.lat, initialPosition.lng]);
            setMarkerPosition(latLng);
        }
    }, [initialPosition]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Debounced address search
    useEffect(() => {
        if (!searchQuery || searchQuery.trim().length < 3) {
            setSearchResults([]);
            setIsDropdownOpen(false);
            return;
        }

        const timer = setTimeout(async () => {
            setIsSearching(true);
            const results = await searchAddress(searchQuery);
            setSearchResults(results);
            setIsDropdownOpen(results.length > 0);
            setIsSearching(false);
        }, 450);

        return () => clearTimeout(timer);
    }, [searchQuery]);

    const handleSelectResult = (result: GeocodingSearchResult) => {
        const newPos: [number, number] = [result.lat, result.lng];
        setPosition(newPos);
        const latLng = L.latLng(result.lat, result.lng);
        setMarkerPosition(latLng);
        setSelectedAddressText(result.displayName);
        setSearchQuery(result.displayName);
        setIsDropdownOpen(false);

        onLocationSelect({ lat: result.lat, lng: result.lng });
        if (onAddressSelect) {
            onAddressSelect(result.address);
        }
    };

    const handleMarkerDragEnd = async (e: any) => {
        const marker = e.target;
        if (!marker) return;
        const latLng = marker.getLatLng();
        setMarkerPosition(latLng);
        onLocationSelect({ lat: latLng.lat, lng: latLng.lng });

        if (onAddressSelect) {
            const address = await reverseGeocode(latLng.lat, latLng.lng);
            if (address) {
                onAddressSelect(address);
                const streetText = `${address.street} ${address.number}, ${address.city}`;
                setSelectedAddressText(streetText);
            }
        }
    };

    const handleUseCurrentLocation = () => {
        if (!navigator.geolocation) {
            alert("La geolocalización no es soportada por este navegador.");
            return;
        }

        setIsLocating(true);
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const latLng = L.latLng(lat, lng);
                setPosition([lat, lng]);
                setMarkerPosition(latLng);
                onLocationSelect({ lat, lng });

                if (onAddressSelect) {
                    const address = await reverseGeocode(lat, lng);
                    if (address) {
                        onAddressSelect(address);
                        const streetText = `${address.street} ${address.number}, ${address.city}`;
                        setSelectedAddressText(streetText);
                        setSearchQuery(streetText);
                    }
                }
                setIsLocating(false);
            },
            (err) => {
                console.warn("Error obteniendo ubicación GPS:", err);
                setIsLocating(false);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    return (
        <div className="relative w-full overflow-hidden rounded-lg flex flex-col" style={{ height }}>
            {showSearch && (
                <div ref={searchRef} className="absolute top-3 left-3 right-14 z-[1000] max-w-md shadow-lg">
                    <div className="relative flex items-center">
                        <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onFocus={() => {
                                if (searchResults.length > 0) setIsDropdownOpen(true);
                            }}
                            placeholder="Buscar calle y altura en el mapa..."
                            className="pl-9 pr-9 bg-background/95 backdrop-blur-md border-border shadow-sm text-sm h-10 rounded-lg"
                        />
                        {isSearching && (
                            <Loader2 className="absolute right-3 h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                    </div>

                    {isDropdownOpen && searchResults.length > 0 && (
                        <div className="mt-1 bg-background/98 backdrop-blur-md border rounded-lg shadow-2xl max-h-60 overflow-y-auto divide-y">
                            {searchResults.map((res) => (
                                <button
                                    key={res.id}
                                    type="button"
                                    onClick={() => handleSelectResult(res)}
                                    className="w-full text-left p-2.5 hover:bg-accent/80 transition-colors flex items-start gap-2 text-xs"
                                >
                                    <MapPin className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                                    <div className="flex-grow">
                                        <p className="font-semibold text-foreground truncate">{res.displayName}</p>
                                        <p className="text-[11px] text-muted-foreground">
                                            {res.address.street} {res.address.number}, {res.address.city}, {res.address.province}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* GPS Button */}
            <div className="absolute top-3 right-3 z-[1000]">
                <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    onClick={handleUseCurrentLocation}
                    disabled={isLocating}
                    title="Usar mi ubicación actual"
                    className="h-10 w-10 shadow-md bg-background/95 backdrop-blur-md hover:bg-background"
                >
                    {isLocating ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                        <Navigation className="h-4 w-4 text-primary" />
                    )}
                </Button>
            </div>

            <div className="w-full h-full min-h-[300px] flex-grow">
                <MapContainer
                    center={position}
                    zoom={initialPosition ? 16 : 13}
                    style={{ height: '100%', width: '100%' }}
                >
                    <ChangeView center={position} zoom={initialPosition ? 16 : 13} />
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapEvents
                        onLocationSelect={onLocationSelect}
                        onAddressSelect={onAddressSelect}
                        setMarkerPosition={(pos) => setMarkerPosition(pos)}
                    />
                    {markerPosition && (
                        <Marker
                            position={markerPosition}
                            draggable={true}
                            eventHandlers={{
                                dragend: handleMarkerDragEnd,
                            }}
                        />
                    )}
                </MapContainer>
            </div>

            {/* Bottom hint banner */}
            <div className="bg-background/90 backdrop-blur-sm border-t px-3 py-1.5 text-xs text-muted-foreground flex items-center justify-between flex-wrap gap-2">
                <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    {markerPosition ? (
                        <span>
                            Punto fijado: <strong>{markerPosition.lat.toFixed(5)}, {markerPosition.lng.toFixed(5)}</strong>
                            {selectedAddressText ? ` (${selectedAddressText.split(',')[0]})` : ''}
                        </span>
                    ) : (
                        <span>Haz clic o busca una dirección para colocar el marcador</span>
                    )}
                </span>
                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                    💡 Puedes arrastrar el marcador para afinar la ubicación exacta
                </span>
            </div>
        </div>
    );
};

export default InteractiveMap;
