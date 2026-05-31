
export type CardType = 'master' | 'spirit_normal' | 'spirit_resonance' | 'trace';

export interface AssetLibrary {
  templates: {
    master: string;
    spirit_normal: string;
    spirit_resonance: string;
    trace: string;
  };
  attributes: {
    [key: string]: string;
  };
  costs: {
    [key: number]: string;
  };
}

export interface CardData {
  name: string;
  cardType: CardType;
  image: string;
  matrix: number[]; // 16 elements for 4x4 grid
  
  // New fields for assets
  attribute: string; // "红", "绿", "蓝", "黄", "黑", "白"
  serialNumber: string;
  flavorText: string;
  imageScale?: number;
  imageOffset?: { x: number; y: number };

  master: {
    state: string; // e.g., "未觉醒", "觉醒"
    triggerCondition: string;
    activeSkill: string;
    passiveSkill: string;
    maintenance: string;
  };

  spirit: {
    cost: number;
    attributes: string[];
    trait: string;
    keywords: string[];
    race: string;
    attack: number;
    domainValue: number;
    effectText: string;
  };

  trace: {
    traceType: string; // "普通", "结界"
    cost: number;
    effectCost: string;
    canUseOnOpponentTurn: boolean;
    extraCost: string;
    effectText: string;
  };
}

export interface SavedCard {
  id: string;
  createdAt: number;
  groupId?: string;
  assetsSnapshot?: AssetLibrary;
  cardData: CardData;
}

export const INITIAL_ASSETS: AssetLibrary = {
  templates: {
    master: "https://picsum.photos/seed/master-bg/400/533",
    spirit_normal: "https://img.51shazhu.com/autoupload/nCMjeHc7Z1JMGTdUwnj-xNiO_OyvX7mIgxFBfDMDErs/20260322/cQNk/2787X4063/%E6%99%AE%E9%80%9A%E5%9F%9F%E7%81%B5%E5%BA%95%E5%9B%BE.png",
    spirit_resonance: "https://img.51shazhu.com/autoupload/nCMjeHc7Z1JMGTdUwnj-xNiO_OyvX7mIgxFBfDMDErs/20260323/PQ9C/2787X4063/%E5%85%B1%E9%B8%A3%E5%9F%9F%E7%81%B5%E5%BA%95%E5%9B%BE.png",
    trace: "/assets/card-templates/trace-template.png",
  },
  attributes: {
    "蓝": "/assets/card-icons/attr-blue.png",
    "绿": "/assets/card-icons/attr-green.png",
    "黄": "/assets/card-icons/attr-yellow.png",
    "白": "/assets/card-icons/attr-white.png",
    "黑": "/assets/card-icons/attr-black.png",
    "红": "/assets/card-icons/attr-red.png",
    "痕迹": "/assets/card-icons/attr-trace.png",
  },
  costs: {
    1: "/assets/card-icons/cost-1.png",
    2: "/assets/card-icons/cost-2.png",
    3: "/assets/card-icons/cost-3.png",
    4: "/assets/card-icons/cost-4.png",
    5: "/assets/card-icons/cost-5.png",
    6: "/assets/card-icons/cost-6.png",
  }
};

export const INITIAL_CARD_DATA: CardData = {
  name: "幻王·奥斯维尔",
  cardType: 'spirit_normal',
  image: "https://picsum.photos/seed/spirit-art/400/300",
  matrix: Array(16).fill(0),
  attribute: "黑",
  serialNumber: "AA-001",
  flavorText: "风吟万境，我行万里，与你共鸣。",
  imageScale: 1,
  imageOffset: { x: 0, y: 0 },
  master: {
    state: "未觉醒",
    triggerCondition: "",
    activeSkill: "",
    passiveSkill: "",
    maintenance: ""
  },
  spirit: {
    cost: 2,
    attributes: ["黑"],
    trait: "限制/共鸣",
    keywords: ["限制", "共鸣", "遗言"],
    race: "人界域",
    attack: 1800,
    domainValue: 500,
    effectText: "【限制】此卡名的共鸣和遗言效果1回合仅可各使用1次。【共鸣】抽1张卡。【遗言】选择手牌中的1只费用5以下的域灵，将其特殊召唤。"
  },
  trace: {
    traceType: "普通",
    cost: 1,
    effectCost: "",
    canUseOnOpponentTurn: false,
    extraCost: "",
    effectText: ""
  }
};
