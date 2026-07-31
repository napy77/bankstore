import { Bank, CreditCard } from '../types';

export const BANKS: Bank[] = [
  {
    id: 'ciudad',
    name: 'Banco Ciudad',
    logoColor: 'from-blue-600 to-blue-400',
    accentColor: 'bg-blue-600',
    textColor: 'text-blue-600',
    promos: [
      {
        category: 'electrohogar',
        maxCuotas: 24,
        discountPercent: 10,
        capAmount: 40000,
        description: 'Hasta 24 cuotas sin interés y 10% de descuento en Electrohogar.'
      },
      {
        category: 'tecnologia',
        maxCuotas: 12,
        discountPercent: 5,
        capAmount: 25000,
        description: 'Hasta 12 cuotas sin interés y 5% de descuento en Tecno.'
      }
    ]
  },
  {
    id: 'bna',
    name: 'Banco Nación (BNA)',
    logoColor: 'from-emerald-700 to-teal-500',
    accentColor: 'bg-emerald-600',
    textColor: 'text-emerald-700',
    promos: [
      {
        category: 'tecnologia',
        maxCuotas: 18,
        discountPercent: 15,
        capAmount: 50000,
        description: 'Hasta 18 cuotas sin interés y 15% de descuento en Tecnología con tarjetas BNA.'
      },
      {
        category: 'electrohogar',
        maxCuotas: 12,
        discountPercent: 10,
        capAmount: 35000,
        description: 'Hasta 12 cuotas sin interés y 10% de descuento en Electrohogar.'
      },
      {
        category: 'deportes',
        maxCuotas: 6,
        discountPercent: 20,
        capAmount: 15000,
        description: '6 cuotas sin interés y 20% de ahorro en Deportes.'
      }
    ]
  },
  {
    id: 'macro',
    name: 'Banco Macro',
    logoColor: 'from-blue-900 to-indigo-700',
    accentColor: 'bg-indigo-900',
    textColor: 'text-indigo-900',
    promos: [
      {
        category: 'tecnologia',
        maxCuotas: 12,
        discountPercent: 12,
        capAmount: 45000,
        description: 'Hasta 12 cuotas sin interés y 12% de ahorro en Tecnología.'
      },
      {
        category: 'turismo',
        maxCuotas: 9,
        discountPercent: 10,
        capAmount: 80000,
        description: '9 cuotas sin interés en paquetes turísticos seleccionados.'
      }
    ]
  },
  {
    id: 'galicia',
    name: 'Banco Galicia',
    logoColor: 'from-orange-600 to-amber-500',
    accentColor: 'bg-orange-600',
    textColor: 'text-orange-600',
    promos: [
      {
        category: 'tecnologia',
        maxCuotas: 9,
        discountPercent: 15,
        capAmount: 60000,
        description: 'Beneficio Eminent: 9 cuotas sin interés y 15% de reintegro en Tecnología.'
      },
      {
        category: 'moda',
        maxCuotas: 6,
        discountPercent: 25,
        capAmount: 30000,
        description: '6 cuotas sin interés y 25% de ahorro exclusivo Eminent.'
      },
      {
        category: 'deportes',
        maxCuotas: 6,
        discountPercent: 15,
        capAmount: 20000,
        description: '6 cuotas sin interés y 15% de ahorro.'
      }
    ]
  },
  {
    id: 'provincia',
    name: 'Banco Provincia',
    logoColor: 'from-green-700 to-green-500',
    accentColor: 'bg-green-600',
    textColor: 'text-green-700',
    promos: [
      {
        category: 'electrohogar',
        maxCuotas: 24,
        discountPercent: 15,
        capAmount: 60000,
        description: 'Provincia Compras: Hasta 24 cuotas sin interés y 15% de descuento.'
      },
      {
        category: 'tecnologia',
        maxCuotas: 18,
        discountPercent: 10,
        capAmount: 40000,
        description: 'Provincia Compras: Hasta 18 cuotas sin interés y 10% de descuento.'
      }
    ]
  }
];

export const INITIAL_CARDS: CreditCard[] = [
  {
    id: 'card-1',
    holderName: 'GERMAN YOVAN',
    cardNumber: '•••• •••• •••• 5342',
    expiryDate: '11/31',
    brand: 'visa',
    tier: 'signature',
    bankId: 'galicia',
    bankName: 'Galicia Eminent',
    limit: 2500000,
    availableLimit: 1950000,
    colorTheme: 'navy'
  },
  {
    id: 'card-2',
    holderName: 'GERMAN YOVAN',
    cardNumber: '•••• •••• •••• 8821',
    expiryDate: '08/30',
    brand: 'mastercard',
    tier: 'black',
    bankId: 'bna',
    bankName: 'Banco Nación Black',
    limit: 3000000,
    availableLimit: 3000000,
    colorTheme: 'black'
  },
  {
    id: 'card-3',
    holderName: 'GERMAN YOVAN',
    cardNumber: '•••• •••• •••• 1092',
    expiryDate: '05/29',
    brand: 'visa',
    tier: 'gold',
    bankId: 'ciudad',
    bankName: 'Banco Ciudad Gold',
    limit: 1200000,
    availableLimit: 1200000,
    colorTheme: 'gold'
  },
  {
    id: 'card-4',
    holderName: 'GERMAN YOVAN',
    cardNumber: '•••• •••• •••• 4471',
    expiryDate: '09/32',
    brand: 'amex',
    tier: 'platinum',
    bankId: 'macro',
    bankName: 'Banco Macro Selecta',
    limit: 2200000,
    availableLimit: 1850000,
    colorTheme: 'teal'
  }
];
