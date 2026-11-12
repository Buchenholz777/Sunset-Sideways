import './ui/style.css';
import { GAME_TITLE } from './config/meta';
import { Game } from './game';
import { initConsent } from './consent';

document.title = GAME_TITLE;
const [w1, ...w2] = GAME_TITLE.split(' ');
const l1 = document.querySelector('.logo .l1'), l2 = document.querySelector('.logo .l2');
if (l1 && l2) { l1.textContent = w1; l2.textContent = w2.join(' '); }
new Game();
initConsent();
