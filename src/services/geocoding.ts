/**
 * Servicio de Geocodificación y Búsqueda de Direcciones (Nominatim / Mapbox).
 * Permite buscar direcciones en texto para ubicar en el mapa, y geocodificación inversa
 * (clic en mapa -> autocompletar calle, altura, ciudad, provincia y código postal).
 */

export interface GeocodedAddress {
  street: string;
  number: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface GeocodingSearchResult {
  id: string;
  displayName: string;
  lat: number;
  lng: number;
  address: GeocodedAddress;
}

const USER_AGENT = "PediturnoApp/1.0 (contacto@pediturno.com)";

/**
 * Busca direcciones a partir de un término de búsqueda (Forward Geocoding).
 */
export async function searchAddress(query: string): Promise<GeocodingSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery || cleanQuery.length < 3) return [];

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=ar&q=${encodeURIComponent(cleanQuery)}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      }
    });

    if (!response.ok) {
      console.warn("Error en consulta a Nominatim:", response.statusText);
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data.map((item: any) => {
      const addr = item.address || {};
      const street = addr.road || addr.street || addr.pedestrian || addr.footway || '';
      const number = addr.house_number || '';
      const city = addr.city || addr.town || addr.village || addr.municipality || addr.suburb || addr.city_district || '';
      const province = addr.state || '';
      const postalCode = addr.postcode || '';
      const country = addr.country || 'Argentina';

      return {
        id: String(item.place_id || `${item.lat},${item.lon}`),
        displayName: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        address: {
          street,
          number,
          city,
          province,
          postalCode,
          country,
        }
      };
    });
  } catch (error) {
    console.error("Error al buscar dirección:", error);
    return [];
  }
}

/**
 * Obtiene la dirección legible a partir de coordenadas geográficas (Reverse Geocoding).
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodedAddress | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      }
    });

    if (!response.ok) {
      console.warn("Error en reverse geocoding:", response.statusText);
      return null;
    }

    const data = await response.json();
    const addr = data.address || {};

    const street = addr.road || addr.street || addr.pedestrian || addr.footway || '';
    const number = addr.house_number || '';
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.suburb || addr.city_district || '';
    const province = addr.state || '';
    const postalCode = addr.postcode || '';
    const country = addr.country || 'Argentina';

    return {
      street,
      number,
      city,
      province,
      postalCode,
      country,
    };
  } catch (error) {
    console.error("Error en reverse geocoding:", error);
    return null;
  }
}
