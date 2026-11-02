import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { FleetSite } from '@forepath/loadweaver/frontend/data-access-console';

import { formatCoordinates, projectSite, WORLD_MAP_BOUNDS, WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH } from './fleet-format';

type LonLat = readonly [number, number];

/**
 * Coastlines as `[longitude, latitude]` waypoints (roughly one every few hundred kilometres). Hand-drawn for this
 * project from well-known coastal coordinates (capes, ports, river mouths; no third-party map data), so they carry the
 * repository's license. They only give the site markers an orientation; seas are what the land outlines leave open
 * (Mediterranean, Black Sea, Caspian, Red Sea, Persian Gulf, Hudson Bay).
 */
// prettier-ignore
export const WORLD_OUTLINES: readonly (readonly LonLat[])[] = [
  // North America (clockwise from the Alaskan Arctic coast)
  [
    [-166, 68.9], [-163, 70], [-156.8, 71.3], [-150, 70.4], [-141, 69.6], [-135, 69.5], [-128, 70.2], [-117, 68.8],
    [-110, 68], [-98, 68], [-94, 69], [-90, 68.5], [-85, 69.5], [-81, 68.5], [-86.2, 66.5], [-90, 63.5], [-92.8, 62],
    [-94.2, 58.8], [-92.4, 57], [-87, 55.5], [-82.3, 55], [-80.5, 51.5], [-79, 54.5], [-77, 58], [-78, 60.5],
    [-77.5, 62.4], [-72, 61.9], [-69.5, 59], [-66, 58.8], [-64.5, 60.3], [-61, 56.5], [-57.5, 54], [-55.7, 52.1],
    [-60, 50.2], [-66.5, 50.2], [-64.5, 49], [-64.5, 46.5], [-61, 45.5], [-60, 46.2], [-63.5, 44.5], [-66, 43.8],
    [-66.9, 44.8], [-70.2, 43.7], [-70, 41.8], [-74, 40.6], [-74, 39], [-75.1, 38.8], [-76, 37], [-75.5, 35.3],
    [-77.9, 34], [-79.2, 33.2], [-81, 31.8], [-81.4, 30.3], [-80, 26.7], [-80.4, 25.2], [-81.3, 25.6], [-82.7, 27.6],
    [-83, 29.1], [-84.3, 30], [-86.5, 30.4], [-89.4, 30.1], [-89.2, 29], [-90.5, 29.1], [-93.8, 29.7], [-95, 29.3],
    [-97.2, 27.6], [-97.4, 25.8], [-97.7, 22], [-96.1, 19.2], [-94.5, 18.2], [-91.5, 18.5], [-90.4, 19.9],
    [-90.3, 21], [-87, 21.5], [-87.5, 19.5], [-88.2, 17.5], [-88.5, 15.9], [-86, 15.9], [-83.4, 15.2], [-83.7, 11.2],
    [-81.5, 9], [-79.5, 9.6], [-77.4, 8.6], [-77.9, 7.2], [-80, 7.4], [-82.9, 8], [-85.7, 10], [-87.5, 13],
    [-91.5, 14], [-94, 16.1], [-96.5, 15.7], [-99.9, 16.8], [-105.3, 20.5], [-105.7, 22.5], [-108.9, 25.5],
    [-110.9, 27.9], [-112.8, 30.7], [-114.7, 31.7], [-114.5, 30], [-112.8, 28], [-111.3, 26], [-110.3, 24.2],
    [-109.9, 22.9], [-112.1, 24.8], [-114.9, 27.7], [-116.6, 31.8], [-117.2, 32.7], [-118.4, 33.8], [-120.6, 34.6],
    [-121.9, 36.6], [-122.5, 37.8], [-123.8, 39.8], [-124.4, 42], [-124.1, 46.2], [-124.7, 48.4], [-125, 50],
    [-128, 51], [-130.5, 54.5], [-133.5, 57.5], [-137, 58.8], [-139.7, 59.8], [-144, 60], [-146.5, 61],
    [-149.5, 59.6], [-151.8, 59.2], [-154, 57.5], [-158.5, 56], [-162, 55], [-164.8, 54.4], [-161, 56],
    [-157.5, 58.6], [-162, 58.6], [-162, 59.8], [-165, 60.5], [-164.5, 63], [-161, 64.5], [-166.2, 64.6],
    [-168, 65.6], [-162.6, 66.9],
  ],
  // Arctic Canada: Baffin, Victoria, Banks, Ellesmere; Newfoundland
  [
    [-89, 73.5], [-80, 73.7], [-71, 70.8], [-67, 69.2], [-61.5, 66.6], [-64, 65], [-65, 62.2], [-71, 62.6],
    [-77.5, 64.5], [-73, 67.5], [-81, 70], [-89, 71],
  ],
  [[-119, 71.5], [-110, 73], [-101, 70.5], [-102, 69], [-107, 68.8], [-114, 68.5], [-118.5, 69.5]],
  [[-125.5, 71.9], [-123, 74.3], [-115.5, 73.5], [-117, 72], [-123, 71.2]],
  [[-92, 77], [-80, 76.2], [-75, 78.5], [-70, 80.5], [-62, 82.5], [-76, 83.1], [-92, 81.5], [-90, 79]],
  [[-59.3, 47.6], [-55.9, 51.6], [-53.2, 49.5], [-52.7, 47.5], [-53.7, 46.6], [-56, 47.6]],
  // Greenland, Iceland
  [
    [-73, 78.2], [-66, 80], [-60, 81.8], [-45, 82.8], [-30, 83.6], [-20, 82], [-12, 81.5], [-18, 77], [-20, 72.5],
    [-22, 70.2], [-26, 68.5], [-32, 68], [-38, 65.6], [-40, 64], [-43, 60], [-46, 60.8], [-50, 63.5], [-51.5, 67],
    [-54, 70], [-55, 72.5], [-58, 75.7], [-66, 76.2], [-72, 77.5],
  ],
  [[-24, 65.5], [-22, 66.4], [-18, 66.2], [-14.5, 66.1], [-13.6, 65], [-15, 64.3], [-18.7, 63.4], [-22.7, 63.8]],
  // Caribbean: Cuba, Hispaniola
  [[-84.9, 21.9], [-82, 22.7], [-77, 21.5], [-74.1, 20.2], [-77.7, 19.9], [-80.6, 21.8], [-83, 21.6]],
  [[-74.5, 18.4], [-72.8, 19.9], [-69.5, 19.4], [-68.3, 18.6], [-71.5, 17.6], [-74.4, 18.2]],
  // South America
  [
    [-77.4, 8.6], [-76, 9.4], [-75.5, 10.5], [-74.2, 11.3], [-71.7, 12.4], [-71, 11], [-70.1, 11.8], [-68.2, 10.5],
    [-66, 10.6], [-64, 10.7], [-62, 10.7], [-60.5, 8.5], [-58.2, 6.8], [-55, 6], [-52.3, 4.9], [-51.1, 3.9],
    [-50, 1.8], [-50, 0], [-48.5, -0.8], [-44.3, -2.5], [-41, -2.9], [-38.5, -3.7], [-35.2, -5.5], [-34.8, -7.1],
    [-35.7, -9.6], [-37, -11], [-38.5, -13], [-39, -17.5], [-39.7, -19.6], [-40.9, -22], [-43.2, -23],
    [-46.3, -24], [-48.5, -26], [-48.6, -28.5], [-50.2, -30.5], [-52.5, -33], [-53.4, -33.7], [-54.9, -34.9],
    [-56.2, -34.9], [-58.4, -34.6], [-57.4, -36.3], [-57.6, -38.1], [-62.3, -38.8], [-62.3, -40.6], [-65, -41],
    [-64, -42.5], [-65.5, -45], [-67.5, -46.5], [-65.8, -47.8], [-69.2, -51.6], [-68.4, -52.4], [-68.5, -54.5],
    [-65.3, -54.9], [-67.3, -55.9], [-70.5, -55], [-72, -54], [-75, -51.5], [-74.2, -48], [-75.6, -46.6],
    [-74, -43.5], [-74, -42], [-73.4, -39.8], [-73.1, -36.8], [-71.6, -33], [-71.4, -30], [-71.5, -27],
    [-70.5, -23.6], [-70.2, -18.5], [-71.4, -17.6], [-75.2, -15.4], [-76.3, -13.4], [-77.1, -12], [-79, -8.1],
    [-81.3, -5], [-80.4, -3.4], [-80.9, -2.2], [-80.1, 0], [-78.9, 1.8], [-77.1, 3.9], [-77.4, 6.5], [-77.9, 7.2],
  ],
  // Europe (with the Caucasus); Europe, Asia and Africa overlap a little at the Urals, the Caucasus and Sinai
  [
    [-5.6, 36], [-6.3, 36.8], [-7.4, 37.2], [-8.9, 37], [-8.8, 38.7], [-9.5, 38.8], [-8.9, 40.2], [-8.8, 42],
    [-9.3, 43], [-8, 43.7], [-5.5, 43.6], [-1.8, 43.4], [-1.2, 44.7], [-1.2, 46.2], [-2.2, 47.2], [-4.8, 48.4],
    [-3, 48.8], [-1.6, 48.7], [-1.9, 49.7], [0.1, 49.5], [1.6, 50.2], [2.5, 51.1], [3.6, 51.4], [4.2, 52],
    [4.7, 52.9], [7.2, 53.5], [8.6, 53.9], [8.6, 55], [8.1, 55.5], [8.2, 56.7], [10.6, 57.7], [10.3, 56.2],
    [9.7, 54.9], [10.9, 54.4], [12, 54.2], [13.8, 54.1], [16.6, 54.6], [18.6, 54.8], [19.6, 54.4], [21.1, 55.2],
    [21, 56.5], [21.6, 57.4], [22.6, 57.7], [24.1, 57], [24.3, 57.8], [23.5, 58.3], [23.5, 59.2], [25, 59.5],
    [28, 59.5], [29.9, 60], [28.5, 60.6], [26, 60.4], [22.9, 59.9], [21.4, 60.6], [21.3, 62.5], [22.3, 63.5],
    [24.4, 64.8], [25.4, 65], [24.2, 65.8], [22.2, 65.6], [21.2, 64.8], [20.3, 63.8], [18.5, 63], [17.3, 62.4],
    [17.1, 61], [18.7, 60.1], [18.1, 59.3], [16.7, 57.9], [16.4, 56.7], [15.5, 56.2], [14.2, 55.4], [12.9, 55.4],
    [12.6, 56.1], [11.8, 57.7], [11.1, 59], [10.6, 59.9], [10, 59], [8, 58.1], [6, 58.3], [5.5, 59], [5, 60.4],
    [5, 62], [6.2, 62.5], [8.3, 63.3], [10, 64], [11, 64.8], [12.5, 66], [14, 67.3], [15.5, 68.5], [18.9, 69.6],
    [21, 70.2], [23.6, 70.7], [25.8, 71.1], [28.5, 70.9], [31, 70.3], [33, 69.4], [36.5, 69.1], [41, 67.8],
    [41.3, 66.2], [39, 66.1], [36, 66.5], [34.5, 65.3], [36.5, 64.8], [40.5, 64.5], [43.5, 66.2], [44.2, 68.3],
    [48.5, 67.6], [53.5, 68.6], [57, 68.6], [60, 69], [66, 69], [65, 64], [63, 58], [61, 51.5], [55, 48.5], [53.5, 47.2],
    [51.9, 47.1], [49.5, 46.6], [47.5, 45.6], [47.6, 43], [49.5, 40.5], [49, 38.5], [41.6, 41.6], [39.7, 43.5],
    [37.5, 44.7], [38.2, 46.7], [35.5, 45.4], [33.5, 44.5], [32.5, 45.4], [33.6, 46], [31, 46.6], [30.7, 46.4],
    [29.7, 45.2], [28.6, 44.2], [27.9, 43.2], [28, 41.9], [29, 41.2], [26.2, 40.6], [26.2, 40], [24, 40.7],
    [22.9, 40.6], [22.6, 40], [23, 39], [24, 37.7], [23.1, 36.5], [22.5, 36.4], [21.7, 36.8], [21.1, 37.8],
    [21.6, 38.4], [20.7, 39], [20, 39.7], [19.4, 40.3], [19.4, 41.8], [18.5, 42.5], [16.4, 43.5], [15.2, 44.2],
    [13.6, 45.1], [13.7, 45.7], [12.3, 45.4], [12.3, 44.4], [13.5, 43.6], [14.4, 42.4], [16, 41.4], [17.9, 40.6],
    [18.5, 40.1], [17.1, 40.5], [16.5, 39.5], [17.1, 39], [16, 38], [15.6, 38.1], [15.7, 38.6], [16.2, 39.6],
    [15.6, 40.1], [14.8, 40.6], [14.2, 40.8], [12.6, 41.5], [11.1, 42.4], [10.5, 43], [10.2, 43.9], [9, 44.4],
    [8, 43.9], [7.3, 43.7], [6, 43.1], [5.4, 43.3], [4.8, 43.4], [3.3, 43.2], [3.1, 42.4], [3.2, 41.9],
    [2.2, 41.4], [0.9, 41], [0.2, 40], [-0.3, 39.5], [0.2, 38.8], [-0.5, 38.3], [-0.8, 37.6], [-2.1, 36.7],
    [-4.4, 36.7],
  ],
  // Great Britain, Ireland, Svalbard, Novaya Zemlya, Sicily, Sardinia, Corsica, Crete, Cyprus
  [
    [-5.7, 50], [-3.5, 50.3], [-1, 50.7], [1.4, 51.2], [0.9, 51.8], [1.7, 52.7], [0.3, 53], [0.1, 53.6],
    [-0.6, 54.5], [-1.6, 55.6], [-2.6, 56.5], [-1.8, 57.5], [-3, 58.6], [-5, 58.6], [-5.7, 57.5], [-5.6, 56.4],
    [-6.2, 56.3], [-5.7, 55.3], [-4.9, 54.8], [-3.4, 54.9], [-3, 54], [-3, 53.4], [-4.6, 53.3], [-4.1, 52.8],
    [-4, 52.2], [-5.3, 51.8], [-3.2, 51.4], [-4.2, 51.2],
  ],
  [
    [-6.3, 52.2], [-6.3, 53.3], [-6, 54], [-5.5, 54.6], [-6, 55.2], [-7.3, 55.4], [-8.5, 55], [-8.6, 54.3],
    [-10, 54.2], [-9.5, 53], [-10.3, 52.1], [-9.8, 51.5], [-8.5, 51.6], [-7, 52.1],
  ],
  [[11, 78.5], [16, 80], [27, 80], [22, 77.5], [16, 76.5]],
  [[51.6, 71.5], [57, 73], [61, 76], [69, 77], [66, 75.5], [60, 73.6], [55, 70.6]],
  [[12.4, 38], [15.6, 38.3], [15.2, 37], [14.4, 36.8]],
  [[8.4, 41], [9.8, 40.9], [9.6, 39.2], [8.4, 39]],
  [[8.6, 42.9], [9.4, 43], [9.5, 42], [9.2, 41.4], [8.6, 41.9]],
  [[23.5, 35.5], [26.3, 35.3], [24.8, 34.9]],
  [[32.3, 35.1], [34.6, 35.7], [33.9, 34.6], [32.5, 34.7]],
  // Asia (clockwise from the Urals' Arctic end; Anatolia, the Levant and Arabia included)
  [
    [64, 69.2], [68, 69], [69, 71], [70, 73.5], [73, 72.5], [75, 72.3], [80, 73.5], [87, 74.5], [95, 76.5],
    [104.3, 77.7], [113, 73.8], [118, 73.5], [127, 73.5], [129.5, 72.5], [140, 72.5], [150, 71.5], [160, 70.8],
    [170, 70], [178, 69.3], [180, 68.9], [180, 65], [177.5, 64.7], [179, 62.3], [174, 61.8], [170, 60],
    [166, 60.3], [163.5, 59.9], [163, 58], [162, 56], [160, 54.3], [158.5, 52.9], [156.7, 51], [156.2, 52.8],
    [158.6, 57.8], [163, 62], [160.3, 61.9], [156, 61.4], [154, 59.2], [150.8, 59.6], [143.3, 59.4],
    [138.2, 56.5], [135.3, 54.7], [140.7, 53.1], [141.4, 52.2], [140.5, 48.5], [138, 46], [135.5, 43.9],
    [132.9, 42.8], [131.9, 43.1], [130.7, 42.3], [129.8, 41.8], [127.5, 39.9], [128.6, 38.3], [129.4, 36],
    [129.1, 35.1], [126.4, 34.5], [126.5, 36], [126.6, 37.4], [125.2, 37.7], [124.7, 38.1], [125.2, 39.5],
    [124.4, 39.9], [121.6, 38.9], [121.2, 39.5], [122.2, 40.7], [121, 40.8], [119.5, 39.9], [117.8, 39],
    [118.9, 37.6], [120.4, 37.5], [122.5, 37.4], [120.3, 36], [119.3, 35], [120.9, 32.6], [121.9, 31],
    [121.9, 29.9], [120.6, 27.8], [119.5, 26], [118.1, 24.5], [116.7, 23.4], [114.2, 22.3], [113.5, 22.1],
    [111, 21.4], [110.4, 21], [109.7, 21.6], [108, 21.5], [106.7, 20.7], [105.7, 18.9], [106.5, 17.6],
    [108.3, 16], [109.2, 13.5], [109.2, 11.5], [107.1, 10.4], [105, 8.6], [104.8, 10.3], [103.5, 10.6],
    [102.3, 12.2], [100.9, 12.7], [100.5, 13.5], [99.9, 12.5], [99.2, 10.3], [100.3, 8.2], [101.3, 6.9],
    [102.2, 6.2], [103.4, 4], [103.4, 2.8], [104.3, 1.4], [103.5, 1.3], [101.3, 2.8], [100.4, 4.2], [100.4, 5.5],
    [99.7, 6.9], [98.4, 7.9], [98.6, 10], [98.2, 13.5], [97.6, 16.5], [96.2, 16.8], [94.3, 16], [94.2, 18.8],
    [92.4, 20.7], [91.8, 22.4], [90.5, 22], [88.6, 21.6], [87, 21.4], [86, 20], [85, 19.3], [83.3, 17.7],
    [82.2, 16.6], [80.3, 15.5], [80.3, 13.1], [79.8, 11], [79.3, 10.3], [78.2, 8.9], [77.5, 8.1], [76.3, 9.9],
    [75, 12.6], [74.1, 15.4], [73, 18], [72.8, 19], [72.6, 21.2], [72.3, 21.6], [70.8, 20.7], [69, 22.4],
    [68.5, 23.5], [67, 24.8], [64, 25.3], [61.6, 25.2], [58, 25.6], [57, 27], [56.3, 27.2], [54, 26.6],
    [51.5, 27.8], [50.3, 29.3], [48.6, 30], [47.9, 29.4], [48.8, 27.6], [50.2, 26.2], [50.8, 24.8], [52, 24],
    [54.4, 24.5], [56, 25.6], [56.3, 26.4], [56.7, 24.4], [58.6, 23.6], [59.8, 22.5], [58.8, 20.4], [57.8, 19],
    [55.8, 17.8], [54, 16.9], [52.2, 15.6], [49, 14.5], [45, 12.8], [43.4, 12.7], [42.8, 14.8], [42.6, 16.5],
    [41.2, 19], [39.2, 21.5], [38.1, 24.1], [36.5, 26], [35, 28], [34.9, 29.5], [34.2, 27.7], [32.6, 29.9],
    [32.3, 31.3], [34.2, 31.3], [34.9, 32.8], [35.5, 33.9], [35.8, 35.5], [36, 36.8], [34.6, 36.8], [32.6, 36.1],
    [30.6, 36.8], [29.1, 36.6], [27.4, 37], [26.3, 38.3], [26.8, 39.3], [26.1, 40], [27, 40.4], [29, 40.9],
    [31, 41.1], [33.3, 42], [35.1, 42], [36.3, 41.3], [38, 41], [40, 41], [41.6, 41.6], [44, 43], [47.6, 43], [49.5, 40.5], [49, 38.5], [51, 36.7],
    [53.9, 36.9], [53.9, 37.5], [53, 39.5], [53, 40.9], [52.8, 41.8], [52.5, 42.8], [51.2, 43.6], [50.3, 44.6],
    [51.3, 45.3], [51.9, 47.1], [53.5, 47.2], [55, 51], [57, 58], [59, 64], [62, 69.2],
  ],
  // Chukotka east of the date line
  [[-180, 68.9], [-175, 67.5], [-170, 66.2], [-172, 64.4], [-180, 65]],
  // Japan (Honshu, Kyushu, Shikoku, Hokkaido), Sakhalin, Taiwan, Hainan, Sri Lanka
  [
    [131, 34.4], [132.5, 35.4], [135.2, 35.7], [136.8, 37.3], [138.5, 37.5], [140, 39.5], [140, 40.7],
    [141.5, 41.4], [141.5, 40.5], [142, 39.5], [141, 38.3], [140.9, 36.9], [140.8, 35.7], [139.8, 35],
    [138.8, 34.6], [137, 34.6], [136.8, 34.3], [135.8, 33.5], [135.1, 34.3], [133, 34.3], [131, 33.9],
  ],
  [[129.8, 33.4], [131, 33.9], [131.9, 33], [131.5, 31.4], [130.6, 31], [130.2, 32.6]],
  [[132.5, 33.2], [134, 34.4], [134.7, 33.8], [133, 32.7]],
  [
    [140, 41.4], [141.2, 41.8], [143.3, 41.9], [145.8, 43.4], [144.5, 44.1], [142, 45.5], [141.5, 43.3],
    [140.3, 43.2], [140, 42.3],
  ],
  [[142, 46], [143.6, 46.5], [143, 49.2], [144, 49], [142.8, 54.3], [142.2, 51.5], [141.8, 48.5]],
  [[121, 25.3], [122, 25], [120.8, 21.9], [120.1, 23]],
  [[108.6, 19.2], [110, 20.1], [111, 19.6], [109.5, 18.2]],
  [[79.8, 9.8], [81.9, 7.4], [81.2, 6.1], [80, 6.2]],
  // Philippines (Luzon, Visayas, Mindanao)
  [
    [120, 18.5], [122.2, 18.5], [122, 16.6], [121.5, 14.2], [124, 13], [123.8, 12.6], [120.6, 13.9], [119.8, 16.4],
  ],
  [[121.9, 11.9], [124.5, 12.5], [125.6, 11], [124.8, 10], [123.2, 9.2], [122, 10.5]],
  [[122, 7], [123.5, 8.6], [125.5, 9.8], [126.6, 7.3], [125.4, 5.6], [124, 6.5]],
  // Indonesia (Sumatra, Java, Borneo, Sulawesi), New Guinea
  [
    [95.3, 5.6], [97.5, 5.2], [100.4, 2.3], [103.8, 1], [104.6, -1], [106, -3.2], [105.8, -5.8], [104.5, -5.9],
    [102.3, -4], [100.4, -1], [98.7, 1.7], [96.5, 3.7],
  ],
  [
    [105.2, -6.8], [106.8, -6], [108.5, -6.5], [110.4, -6.9], [112.7, -7.2], [114.4, -7.7], [114.6, -8.7],
    [111, -8.3], [108, -7.8], [106.4, -7.4],
  ],
  [
    [109, 1.5], [109.6, 2], [111.5, 2.5], [113, 3.2], [115.4, 5], [116, 6], [117, 7], [119.3, 5.3], [118, 4.4],
    [118.5, 1], [117.6, 0], [116.7, -1.5], [116.3, -3.9], [114.6, -4.2], [111, -3], [110.2, -2.9], [109.2, -0.5],
  ],
  [
    [119.4, -5.5], [120.5, -5.6], [121.5, -4.6], [120.9, -2.7], [122, -1], [123.4, -0.9], [121.2, 0.4],
    [124.8, 1.5], [125, 0.9], [120, 0.7], [119.8, -0.3], [118.8, -2.7],
  ],
  [
    [131, -1.2], [134, -0.9], [137.8, -1.5], [141, -2.6], [145.7, -4.8], [147.5, -6.1], [150, -10.4], [147, -10],
    [146, -8], [143.5, -9.1], [141, -9.1], [138, -8.4], [137.9, -5.4], [135, -4.4], [132, -2.8],
  ],
  // Africa, Madagascar
  [
    [-5.9, 35.8], [-2.9, 35.2], [-1, 35.7], [1.5, 36.6], [3, 36.8], [5.5, 36.8], [8.6, 36.9], [10.2, 37.2],
    [11.1, 36.9], [10.4, 36], [11, 35.2], [10, 34], [11.5, 33.2], [13.2, 32.9], [15.3, 32.3], [15.8, 31.4],
    [18, 30.8], [19.6, 30.5], [20.1, 31.9], [21.5, 32.8], [23, 32.6], [25, 31.7], [29.9, 31.2], [31, 31.6],
    [32.3, 31.3], [33.5, 31.1], [33.5, 29.2], [32.6, 29.9], [32.7, 28], [33.9, 26.6], [35.5, 23.9], [36.9, 22], [37.2, 19.6], [38.6, 18],
    [39.7, 15.6], [41.7, 13.9], [43.3, 12.4], [44, 10.4], [45, 10.4], [48, 11.2], [51.3, 11.8], [51, 10.4],
    [50.9, 9], [49, 6], [47.5, 4], [45.3, 2], [43, -0.5], [41.6, -1.7], [40.2, -3], [39.7, -4], [39.3, -6.8],
    [39.5, -9], [40.5, -10.5], [40.6, -14], [40, -16], [37, -17.5], [35.4, -21.5], [35.5, -24], [32.9, -25.9],
    [32.6, -28.5], [31, -29.9], [27.9, -33], [25.6, -34], [22, -34.2], [20, -34.8], [18.4, -34.3], [18, -32.5],
    [16.5, -28.6], [15.2, -26.6], [14.5, -22.9], [13, -20], [11.8, -17.3], [12.2, -14], [13.4, -12.5],
    [13.2, -8.8], [12.3, -6.1], [11.8, -4.8], [8.7, -0.7], [9.5, 1], [9.7, 4], [8.5, 4.5], [7, 4.4], [6, 4.3],
    [5, 5.6], [3.4, 6.4], [1, 6], [-2, 4.8], [-4, 5.2], [-7.5, 4.4], [-9.5, 5.4], [-11.5, 6.9], [-13.2, 8.5],
    [-15, 10.8], [-16.7, 12.4], [-17.5, 14.7], [-16.5, 16], [-16.1, 18], [-16.5, 19.5], [-17.1, 21],
    [-16, 23.7], [-14.5, 26.1], [-13, 27.6], [-11.5, 28.2], [-9.8, 29.5], [-9.6, 30.4], [-9.8, 31.5],
    [-8.6, 33.3], [-6.8, 34],
  ],
  [
    [49.3, -12], [50.5, -15.5], [49.5, -17.5], [47.1, -24.9], [45.2, -25.6], [43.7, -23.4], [44, -20],
    [44.4, -16.2], [46.5, -15.5], [48, -13.5],
  ],
  // Australia, Tasmania, New Zealand
  [
    [113.6, -22], [114.6, -21.8], [116.7, -20.6], [118.8, -20.3], [121, -19.5], [122.2, -18], [123.6, -16.6],
    [125, -14.9], [127, -14], [128.2, -15], [129.6, -14.9], [130.6, -12.4], [132.6, -11.5], [135, -12.2],
    [136.8, -12.2], [136, -13.6], [135.5, -15], [137.5, -16.2], [139.5, -17.5], [140.8, -17.4], [141.6, -15],
    [141.5, -12.6], [142.5, -10.7], [143.5, -12.5], [143.8, -14.4], [145.4, -14.9], [145.8, -16.9],
    [146.8, -19.3], [148.8, -20.3], [150.5, -22.4], [151.5, -24], [153, -25.2], [153.4, -27.5], [153.6, -28.6],
    [152.9, -31.4], [151.3, -33.9], [150.2, -35.7], [149.9, -37.5], [147.7, -37.9], [146.4, -39.1],
    [144.9, -37.9], [143.5, -38.8], [140.6, -38], [139.6, -37.2], [139.3, -35.6], [138.5, -34.9],
    [137.8, -35.7], [137.5, -33.2], [135.9, -34.7], [134.2, -32.8], [131, -31.5], [126, -32.3], [123.6, -33.9],
    [120, -34], [118, -35.1], [115, -34.4], [115.7, -32], [114.9, -29.4], [113.4, -26.4], [113.6, -24.5],
  ],
  [[144.6, -40.7], [148.3, -40.9], [148, -43.2], [146, -43.6], [145.2, -42.2]],
  [
    [172.7, -34.4], [174.8, -36.9], [175.9, -37.4], [178.5, -37.7], [177.9, -39.3], [176.9, -39.6],
    [175.2, -41.6], [174.6, -41.3], [173.8, -39.2], [174.6, -37], [173, -35.2],
  ],
  [
    [172.6, -40.5], [174.3, -41.3], [173.9, -42.4], [172.7, -43.8], [171.2, -44.4], [170.6, -45.9],
    [168.4, -46.6], [166.5, -46], [168.3, -44], [170.6, -42.9], [171.9, -41.5],
  ],
];

/** SVG path data of an outline in the map's viewBox (`0 0 360 144`). */
export function outlinePath(points: readonly LonLat[]): string {
  return (
    points
      .map(([lon, lat], i) => {
        const { x, y } = projectSite(lat, lon);

        return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
      })
      .join(' ') + ' Z'
  );
}

/** Graticule every 30° (meridians and parallels inside the map's bounds) as one SVG path. */
export function graticulePath(step = 30): string {
  const { north, south, west, east } = WORLD_MAP_BOUNDS;
  const lines: string[] = [];

  for (let lon = west + step; lon < east; lon += step) {
    const top = projectSite(north, lon);
    const bottom = projectSite(south, lon);

    lines.push(`M${top.x} ${top.y} L${bottom.x} ${bottom.y}`);
  }

  for (let lat = Math.ceil(south / step) * step; lat < north; lat += step) {
    if (lat === south) continue;

    const left = projectSite(lat, west);
    const right = projectSite(lat, east);

    lines.push(`M${left.x} ${left.y} L${right.x} ${right.y}`);
  }

  return lines.join(' ');
}

export interface FleetMapMarker {
  key: string;
  site: FleetSite;
  title: string;
  coordinates: string;
  /** Position of the true location in percent of the map's width / height. */
  left: number;
  top: number;
  /** Offset in pixels (sites spread around a shared location; 0 for single sites). */
  dx: number;
  dy: number;
  /** Size of the group this marker belongs to (1: alone). */
  group: number;
  /** CSS `left` / `top` of the marker button: offset applied, kept inside the frame (sites on the map's edge). */
  cssLeft: string;
  cssTop: string;
}

function inFrame(percent: number, offset: number): string {
  return `clamp(0px, calc(${percent}% + ${offset - MARKER_SIZE / 2}px), calc(100% - ${MARKER_SIZE}px))`;
}

/** Marker diameter in pixels; sites closer than this on screen spread around their shared spot. */
export const MARKER_SIZE = 12;

/**
 * Markers for the sites: projected, and sites that would overlap at the current map width (`widthPx`) spread on a
 * small ring around their group's first site, so each stays visible and clickable.
 */
export function mapMarkers(sites: readonly FleetSite[], widthPx: number): FleetMapMarker[] {
  const scale = Math.max(widthPx, 1) / WORLD_MAP_WIDTH;
  const groups: { x: number; y: number; members: FleetSite[] }[] = [];
  const sorted = [...sites].sort(
    (a, b) =>
      a.clusterName.localeCompare(b.clusterName) ||
      a.site.localeCompare(b.site) ||
      a.clusterId.localeCompare(b.clusterId),
  );

  for (const site of sorted) {
    const { x, y } = projectSite(site.latitude, site.longitude);
    const group = groups.find((g) => Math.hypot((g.x - x) * scale, (g.y - y) * scale) < MARKER_SIZE);

    if (group) group.members.push(site);
    else groups.push({ x, y, members: [site] });
  }

  return groups.flatMap(({ x, y, members }) => {
    const n = members.length;
    // Ring radius so neighbours on the ring do not touch.
    const radius = n === 1 ? 0 : Math.max(MARKER_SIZE, (n * (MARKER_SIZE + 3)) / (2 * Math.PI));

    return members.map((site, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const left = (x / WORLD_MAP_WIDTH) * 100;
      const top = (y / WORLD_MAP_HEIGHT) * 100;
      const dx = Math.round(radius * Math.cos(angle) * 10) / 10 || 0; // no -0
      const dy = Math.round(radius * Math.sin(angle) * 10) / 10 || 0;

      return {
        key: `${site.clusterId}/${site.site}`,
        site,
        title: `${site.label ?? site.site} · ${site.clusterName}`,
        coordinates: formatCoordinates(site.latitude, site.longitude),
        left,
        top,
        dx,
        dy,
        group: n,
        cssLeft: inFrame(left, dx),
        cssTop: inFrame(top, dy),
      };
    });
  });
}

const OUTLINE_PATHS = WORLD_OUTLINES.map(outlinePath);
const GRATICULE_PATH = graticulePath();

let mapSeq = 0;

/**
 * World map of the fleet's sites (3.25): plate carrée (84° N – 60° S), hand-drawn coastlines over a 30° graticule,
 * sites with a `Site.spec.location` as markers. A marker is a button (hover / focus shows the site, its cluster and
 * coordinates; click / Enter / Space opens that cluster); sites at the same spot spread around it. Purely SVG and
 * HTML, no map tiles or external requests.
 */
@Component({
  selector: 'loadweaver-fleet-world-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'lw-world-map d-block' },
  styles: `
    .lw-world-map__frame {
      position: relative;
      width: 100%;
      aspect-ratio: ${WORLD_MAP_WIDTH} / ${WORLD_MAP_HEIGHT};
      border: var(--bs-border-width) solid var(--bs-border-color);
      border-radius: var(--bs-border-radius);
      background: var(--bs-body-bg);
      overflow: hidden;
    }

    .lw-world-map__backdrop {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }

    .lw-world-map__graticule {
      fill: none;
      stroke: var(--bs-border-color);
      stroke-width: 1px;
      vector-effect: non-scaling-stroke;
      opacity: 0.6;
    }

    /* Coastline: every outline stroked below, filled above — the fill hides the seams where outlines meet (Urals,
       Caucasus, Sinai), only the outer half of the stroke stays as a hairline coast. */
    .lw-world-map__coast path {
      fill: none;
      stroke: color-mix(in srgb, var(--bs-body-color) 26%, var(--bs-body-bg));
      stroke-width: 2px;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }

    .lw-world-map__land path {
      /* Same contrast in light and dark: a tint of the text colour on the page background. */
      fill: color-mix(in srgb, var(--bs-body-color) 10%, var(--bs-body-bg));
    }

    .lw-world-map__anchor {
      position: absolute;
      width: 4px;
      height: 4px;
      margin: -2px 0 0 -2px;
      border-radius: 50%;
      background: var(--bs-emphasis-color);
      pointer-events: none;
    }

    .lw-world-map__site {
      position: absolute;
      width: ${MARKER_SIZE}px;
      height: ${MARKER_SIZE}px;
      padding: 0;
      border: 2px solid var(--bs-body-bg);
      border-radius: 50%;
      background: var(--bs-primary);
      outline: 1px solid var(--bs-emphasis-color);
      outline-offset: 0;
      cursor: pointer;
    }

    .lw-world-map__site:hover,
    .lw-world-map__site--active {
      z-index: 2;
      outline-width: 2px;
    }

    .lw-world-map__site:focus-visible {
      z-index: 2;
      outline: 2px solid var(--bs-emphasis-color);
      outline-offset: 2px;
    }

    .lw-world-map__tip {
      position: absolute;
      z-index: 3;
      max-width: min(16rem, 90%);
      width: max-content;
      padding: 0.25rem 0.5rem;
      border-radius: var(--bs-border-radius);
      background-color: var(--bs-emphasis-color);
      color: var(--bs-body-bg);
      font-size: 0.75rem;
      line-height: 1.35;
      pointer-events: none;
    }
  `,
  template: `
    <div class="lw-world-map__frame" role="group" [attr.aria-label]="ariaLabel()" data-testid="fleet-world-map">
      <svg
        class="lw-world-map__backdrop"
        [attr.viewBox]="viewBox"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path class="lw-world-map__graticule" [attr.d]="graticule" />
        <g class="lw-world-map__coast">
          @for (d of outlines; track $index) {
            <path [attr.d]="d" />
          }
        </g>
        <g class="lw-world-map__land">
          @for (d of outlines; track $index) {
            <path [attr.d]="d" />
          }
        </g>
      </svg>
      @for (marker of markers(); track marker.key) {
        @if (marker.group > 1) {
          <span class="lw-world-map__anchor" [style.left.%]="marker.left" [style.top.%]="marker.top"></span>
        }
        <button
          type="button"
          class="lw-world-map__site"
          [class.lw-world-map__site--active]="active()?.key === marker.key"
          [style.left]="marker.cssLeft"
          [style.top]="marker.cssTop"
          [attr.aria-label]="marker.title + ', ' + marker.coordinates"
          [attr.aria-describedby]="active()?.key === marker.key ? tipId : null"
          (click)="siteSelected.emit(marker.site)"
          (mouseenter)="activeKey.set(marker.key)"
          (mouseleave)="activeKey.set(null)"
          (focus)="activeKey.set(marker.key)"
          (blur)="activeKey.set(null)"
          data-testid="fleet-map-site"
        ></button>
      }
      @if (active(); as tip) {
        <div
          class="lw-world-map__tip"
          role="tooltip"
          [id]="tipId"
          [style.left]="tip.left < 50 ? 'calc(' + tip.left + '% + ' + (tip.dx + markerSize) + 'px)' : null"
          [style.right]="tip.left >= 50 ? 'calc(' + (100 - tip.left) + '% - ' + (tip.dx - markerSize) + 'px)' : null"
          [style.top]="tip.top < 50 ? 'calc(' + tip.top + '% + ' + tip.dy + 'px)' : null"
          [style.bottom]="tip.top >= 50 ? 'calc(' + (100 - tip.top) + '% - ' + tip.dy + 'px)' : null"
          data-testid="fleet-map-tip"
        >
          <div class="fw-semibold">{{ tip.title }}</div>
          <div class="font-monospace">{{ tip.coordinates }}</div>
        </div>
      }
    </div>
  `,
})
export class LoadweaverFleetWorldMapComponent {
  readonly sites = input<FleetSite[]>([]);
  readonly ariaLabel = input('World map of sites');
  readonly siteSelected = output<FleetSite>();

  readonly outlines = OUTLINE_PATHS;
  readonly graticule = GRATICULE_PATH;
  readonly viewBox = `0 0 ${WORLD_MAP_WIDTH} ${WORLD_MAP_HEIGHT}`;
  readonly markerSize = MARKER_SIZE;
  readonly tipId = `lw-world-map-tip-${++mapSeq}`;

  /** Rendered width of the map in pixels (spreads close sites); a typical lane width until measured. */
  readonly width = signal(360);
  readonly activeKey = signal<string | null>(null);

  readonly markers = computed(() => mapMarkers(this.sites(), this.width()));
  readonly active = computed(() => this.markers().find((m) => m.key === this.activeKey()) ?? null);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const measure = (): void => {
        const width = host.getBoundingClientRect().width;

        if (width > 0) this.width.set(Math.round(width));
      };

      measure();

      if (typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver(measure);

      observer.observe(host);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
