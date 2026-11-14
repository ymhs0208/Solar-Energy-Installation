import { getPosition } from 'suncalc';

export function getSolarPosition(date: Date, lat: number, lon: number) {
  const { altitude, azimuth } = getPosition(date, lat, lon);
  return {
    altitudeRad: altitude * Math.PI / 180,
    southAzimuthRad: (azimuth - 180) * Math.PI / 180,
    altitudeDeg: altitude,
    compassAzimuthDeg: azimuth,
  };
}
