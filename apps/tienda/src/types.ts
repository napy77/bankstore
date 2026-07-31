/**
 * Types and interfaces for the Bank Marketplace
 */

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'cabal';
export type CardTier = 'black' | 'signature' | 'platinum' | 'gold' | 'classic';

export interface CreditCard {
  id: string;
  holderName: string;
  cardNumber: string;
  expiryDate: string;
  brand: CardBrand;
  tier: CardTier;
  bankId: string;
  bankName: string;
  limit: number;
  availableLimit: number;
  colorTheme: 'navy' | 'black' | 'platinum' | 'gold' | 'red' | 'teal';
}

export interface BankPromo {
  category: string;
  maxCuotas: number;
  discountPercent: number; // e.g. 15 for 15% discount
  capAmount?: number; // maximum reintegro cap
  description: string;
}

export interface Bank {
  id: string;
  name: string;
  logoColor: string;
  accentColor: string;
  textColor: string;
  promos: BankPromo[];
}

export interface ProductBankOffer {
  bankId: string;
  maxCuotas: number;
  discountPercent: number;
  extraReintegroPercent?: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  originalPrice?: number;
  category: 'tecnologia' | 'electrohogar' | 'turismo' | 'deportes' | 'moda';
  rating: number;
  reviewsCount: number;
  image: string; // Tailored CSS gradient + illustration identifier
  specs: string[];
  stock: number;
  bankOffers: ProductBankOffer[];
  features?: string[];
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Purchase {
  id: string;
  date: string;
  items: {
    productId: string;
    productName: string;
    price: number;
    quantity: number;
  }[];
  totalAmount: number;
  cardUsed: {
    bankName: string;
    brand: CardBrand;
    cardNumber: string;
  };
  installments: number;
  installmentPrice: number;
  cft: number;
  reintegroAmount: number;
}
