import { createRng, pick } from '@/lib/rng'

/**
 * 每家厂商门店的建筑风格（纯数据）：外墙、屋顶、雨棚和屋顶装饰各不相同，
 * 让人不看招牌也能大致认出是哪家店。装饰只是对品牌气质的联想，不复刻任何商标图形；
 * 真正的 Logo 只出现在门头招牌和门边挂牌上。表外厂商按 id 生成一套街角老店风格。
 */
export type RoofKind = 'flat' | 'gable' | 'sawtooth' | 'eaves' | 'dome' | 'barrel'
export type FacadeKind = 'glass' | 'brick' | 'timber' | 'stucco' | 'panel' | 'stone'
export type AwningKind = 'stripes' | 'solid' | 'scallop' | 'canopy' | 'none'
export type Ornament =
  | 'garden'
  | 'chimney'
  | 'blocks'
  | 'whale'
  | 'lanterns'
  | 'moon'
  | 'dish'
  | 'wave'
  | 'bean'
  | 'rocket'
  | 'cloud'
  | 'car'
  | 'pixels'
  | 'loop'
  | 'scroll'
  | 'tower'

export interface LabStyle {
  wall: string
  trim: string
  /** 品牌主色：招牌底、门框、雨棚。 */
  accent: string
  /** 门头招牌底色；缺省用品牌主色。 */
  sign?: string
  roof: RoofKind
  roofColor: string
  /** 店面层以上的楼层数。 */
  upperFloors: number
  facade: FacadeKind
  awning: AwningKind
  /** 雨棚配色；条纹雨棚按顺序循环。 */
  awningColors: string[]
  ornament: Ornament
  /** 一句话描述门店特色，展示在店铺详情里。 */
  motif: string
}

const STYLES: Record<string, LabStyle> = {
  openai: {
    wall: '#f3f1ec',
    trim: '#1d1f22',
    accent: '#10a37f',
    sign: '#1d1f22',
    roof: 'flat',
    roofColor: '#3a3d42',
    upperFloors: 2,
    facade: 'glass',
    awning: 'canopy',
    awningColors: ['#1d1f22'],
    ornament: 'garden',
    motif: '极简白色玻璃楼，屋顶花园',
  },
  anthropic: {
    wall: '#ebdfca',
    trim: '#5a4637',
    accent: '#d97757',
    roof: 'gable',
    roofColor: '#b0603c',
    upperFloors: 1,
    facade: 'timber',
    awning: 'solid',
    awningColors: ['#d97757'],
    ornament: 'chimney',
    motif: '陶土色木构书店，坡顶砖烟囱',
  },
  google: {
    wall: '#f7f7f5',
    trim: '#c9ccd1',
    accent: '#4285f4',
    sign: '#ffffff',
    roof: 'flat',
    roofColor: '#8d9096',
    upperFloors: 1,
    facade: 'panel',
    awning: 'stripes',
    awningColors: ['#4285f4', '#ea4335', '#fbbc05', '#34a853'],
    ornament: 'blocks',
    motif: '四色条纹雨棚，屋顶彩色积木',
  },
  deepseek: {
    wall: '#dce5f6',
    trim: '#20357f',
    accent: '#4d6bfe',
    roof: 'barrel',
    roofColor: '#2f4fd8',
    upperFloors: 1,
    facade: 'panel',
    awning: 'scallop',
    awningColors: ['#4d6bfe', '#f4f7ff'],
    ornament: 'whale',
    motif: '深海蓝拱顶，屋顶趴着一头鲸',
  },
  qwen: {
    wall: '#ece7fb',
    trim: '#3a2e8c',
    accent: '#615ced',
    roof: 'eaves',
    roofColor: '#463bb3',
    upperFloors: 1,
    facade: 'stucco',
    awning: 'none',
    awningColors: ['#615ced'],
    ornament: 'lanterns',
    motif: '紫色飞檐，檐下一排灯笼',
  },
  moonshot: {
    wall: '#2a2f3d',
    trim: '#aab3c7',
    accent: '#3b6ff5',
    sign: '#101318',
    roof: 'dome',
    roofColor: '#c9d0de',
    upperFloors: 1,
    facade: 'stone',
    awning: 'canopy',
    awningColors: ['#1b1f2a'],
    ornament: 'moon',
    motif: '夜空色天文台，穹顶旁挂一弯新月',
  },
  zhipu: {
    wall: '#e2f1f0',
    trim: '#0b5d5a',
    accent: '#0e9f9a',
    roof: 'sawtooth',
    roofColor: '#5f7d7b',
    upperFloors: 1,
    facade: 'panel',
    awning: 'solid',
    awningColors: ['#0e9f9a'],
    ornament: 'dish',
    motif: '锯齿顶实验工坊，屋顶卫星天线',
  },
  minimax: {
    wall: '#fbeaed',
    trim: '#8b1c31',
    accent: '#e8445a',
    roof: 'flat',
    roofColor: '#5a4448',
    upperFloors: 1,
    facade: 'glass',
    awning: 'canopy',
    awningColors: ['#8b1c31'],
    ornament: 'wave',
    motif: '玻璃声学房，屋顶声波霓虹',
  },
  bytedance: {
    wall: '#eee9ff',
    trim: '#4a3aa6',
    accent: '#7b61ff',
    roof: 'flat',
    roofColor: '#b9aef5',
    upperFloors: 0,
    facade: 'stucco',
    awning: 'scallop',
    awningColors: ['#7b61ff', '#ffd9e8'],
    ornament: 'bean',
    motif: '软萌圆角小屋，屋顶一颗大豆子',
  },
  xai: {
    wall: '#1c1d20',
    trim: '#e4e4e4',
    accent: '#8a9099',
    sign: '#0b0b0d',
    roof: 'flat',
    roofColor: '#2a2b2f',
    upperFloors: 2,
    facade: 'glass',
    awning: 'none',
    awningColors: ['#1c1d20'],
    ornament: 'rocket',
    motif: '黑色金属方楼，屋顶立着火箭',
  },
  tencent: {
    wall: '#e5eefb',
    trim: '#0f3e88',
    accent: '#1e6fd9',
    roof: 'gable',
    roofColor: '#2a5db0',
    upperFloors: 1,
    facade: 'stucco',
    awning: 'solid',
    awningColors: ['#1e6fd9'],
    ornament: 'cloud',
    motif: '蓝白小楼，屋顶飘着云朵',
  },
  xiaomi: {
    wall: '#f7f3ee',
    trim: '#5b4a3e',
    accent: '#ff6900',
    roof: 'flat',
    roofColor: '#9a8f86',
    upperFloors: 0,
    facade: 'panel',
    awning: 'solid',
    awningColors: ['#ff6900'],
    ornament: 'car',
    motif: '橙色圆角店面，屋顶展示一辆小车',
  },
  mistral: {
    wall: '#fbf0d2',
    trim: '#7a2a0a',
    accent: '#f2a900',
    roof: 'flat',
    roofColor: '#8c6f55',
    upperFloors: 1,
    facade: 'stone',
    awning: 'stripes',
    awningColors: ['#fa500f', '#fbf0d2'],
    ornament: 'pixels',
    motif: '法式小馆条纹雨棚，屋顶像素色块',
  },
  meta: {
    wall: '#e6f0fc',
    trim: '#1c2b41',
    accent: '#2d8cf0',
    roof: 'flat',
    roofColor: '#56657a',
    upperFloors: 2,
    facade: 'glass',
    awning: 'canopy',
    awningColors: ['#1c2b41'],
    ornament: 'loop',
    motif: '玻璃幕墙楼，屋顶无限环雕塑',
  },
  baidu: {
    wall: '#e8eafb',
    trim: '#1b2090',
    accent: '#2932e1',
    roof: 'gable',
    roofColor: '#2d3380',
    upperFloors: 1,
    facade: 'stone',
    awning: 'solid',
    awningColors: ['#2932e1'],
    ornament: 'scroll',
    motif: '书院风石墙，屋顶摊开一卷书',
  },
}

const OLD_WALLS = ['#b9a58f', '#c9b79c', '#a98f7a', '#d4c4ab', '#9c8f86', '#bfae9e']
const OLD_ROOFS: RoofKind[] = ['flat', 'gable', 'sawtooth']

export function hasLabStyle(id: string): boolean {
  return id in STYLES
}

/** 厂商门店风格；表外厂商按 id 稳定生成。 */
export function labStyle(id: string, color = '#8a8f98'): LabStyle {
  const known = STYLES[id]
  if (known) return known
  const rng = createRng(`style:${id}`)
  return {
    wall: pick(rng, OLD_WALLS),
    trim: '#f1ebe0',
    accent: color,
    roof: pick(rng, OLD_ROOFS),
    roofColor: '#6f5a4c',
    upperFloors: rng() < 0.5 ? 1 : 0,
    facade: 'brick',
    awning: 'stripes',
    awningColors: [color, '#f4efe6'],
    ornament: 'tower',
    motif: '街角红砖老店，屋顶木水塔',
  }
}
