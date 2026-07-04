'use strict';

const RECIPES = {
  iron_pickaxe: {
    name: 'Iron Pickaxe',
    emoji: '⛏',
    description: 'A sturdy pickaxe for mining',
    inputs: { iron_ore: 5, stone: 3 },
    output: { id: 'iron_pickaxe', qty: 1 },
  },
  gold_pickaxe: {
    name: 'Gold Pickaxe',
    emoji: '🪙',
    description: 'An upgraded pickaxe for better ore yield',
    inputs: { gold_ore: 3, iron_ore: 5 },
    output: { id: 'gold_pickaxe', qty: 1 },
  },
  diamond_pickaxe: {
    name: 'Diamond Pickaxe',
    emoji: '<:Sketch:1521228025365004471>',
    description: 'The ultimate pickaxe with maximum ore yield',
    inputs: { diamond_ore: 2, gold_ore: 5 },
    output: { id: 'diamond_pickaxe', qty: 1 },
  },
  lucky_charm: {
    name: 'Lucky Charm',
    emoji: '🍀',
    description: 'Craft a lucky charm from rare materials',
    inputs: { emerald_ore: 1, gold_ore: 2 },
    output: { id: 'lucky_charm', qty: 1 },
  },
  shield: {
    name: 'Shield Token',
    emoji: '<:Shield:1521227694677692467>',
    description: 'Craft a protective shield',
    inputs: { iron_ore: 8, stone: 5 },
    output: { id: 'shield', qty: 1 },
  },
  trophy: {
    name: 'Trophy',
    emoji: '<:Award:1521228119640375336>',
    description: 'Craft a prestigious trophy',
    inputs: { gold_ore: 5, diamond_ore: 1 },
    output: { id: 'trophy', qty: 1 },
  },
};

function getRecipe(id) {
  return RECIPES[id] || null;
}

function getAllRecipes() {
  return Object.entries(RECIPES).map(([id, r]) => ({ id, ...r }));
}

module.exports = { RECIPES, getRecipe, getAllRecipes };
