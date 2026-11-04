import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Gift, Pause, Play } from 'lucide-react';
import gift01 from './assets/cadeaux/cadeau-01.jpg';
import gift02 from './assets/cadeaux/cadeau-02.jpg';
import gift03 from './assets/cadeaux/cadeau-03.jpg';
import gift04 from './assets/cadeaux/cadeau-04.jpg';
import gift05 from './assets/cadeaux/cadeau-05.jpg';
import gift06 from './assets/cadeaux/cadeau-06.jpg';
import gift07 from './assets/cadeaux/cadeau-07.jpg';
import gift08 from './assets/cadeaux/cadeau-08.jpg';
import gift09 from './assets/cadeaux/cadeau-09.jpg';
import gift10 from './assets/cadeaux/cadeau-10.jpg';
import gift11 from './assets/cadeaux/cadeau-11.jpg';
import gift12 from './assets/cadeaux/cadeau-12.jpg';
import gift13 from './assets/cadeaux/cadeau-13.jpg';
import gift14 from './assets/cadeaux/cadeau-14.jpg';
import gift15 from './assets/cadeaux/cadeau-15.jpg';
import gift16 from './assets/cadeaux/cadeau-16.jpg';
import gift17 from './assets/cadeaux/cadeau-17.jpg';
import gift18 from './assets/cadeaux/cadeau-18.jpg';
import gift19 from './assets/cadeaux/cadeau-19.jpg';
import gift20 from './assets/cadeaux/cadeau-20.jpg';
import gift21 from './assets/cadeaux/cadeau-21.jpg';
import gift22 from './assets/cadeaux/cadeau-22.jpg';

const gifts = [
  { image: gift01, label: 'Batterie externe', alt: 'Batterie externe rose Anker' },
  { image: gift02, label: 'Ordinateurs portables', alt: 'Ordinateurs portables présentés en magasin' },
  { image: gift03, label: 'Ordinateur portable', alt: 'Ordinateur portable Dell' },
  { image: gift04, label: 'Ordinateur portable', alt: 'Ordinateur portable sur son emballage' },
  { image: gift05, label: 'Tablette et clavier', alt: 'Tablette avec clavier' },
  { image: gift06, label: 'Tablette Android', alt: 'Tablette Android sur son support' },
  { image: gift07, label: 'Tablette rose', alt: 'Tablette rose et son écran' },
  { image: gift08, label: 'Smartphone Tecno', alt: 'Smartphone Tecno Pop 10 blanc' },
  { image: gift09, label: 'Smartphone Tecno', alt: 'Smartphone Tecno vert' },
  { image: gift10, label: 'Smartphone Tecno', alt: 'Smartphone Tecno Pop 10 gris' },
  { image: gift11, label: 'Smartphones Tecno', alt: 'Smartphones Tecno Camon 50' },
  { image: gift12, label: 'iPhone', alt: 'iPhone violet' },
  { image: gift13, label: 'Smartphones Apple', alt: 'Smartphones Apple rouges' },
  { image: gift14, label: 'iPhone colorés', alt: 'iPhone de plusieurs couleurs' },
  { image: gift15, label: 'Appareils Apple', alt: 'Collection d’appareils Apple' },
  { image: gift16, label: 'Téléphones et accessoires', alt: 'Téléphones et accessoires variés' },
  { image: gift17, label: 'Smartphone Samsung', alt: 'Smartphone Samsung Galaxy' },
  { image: gift18, label: 'Téléphone pliable', alt: 'Smartphone Samsung pliable' },
  { image: gift19, label: 'Accessoires vidéo', alt: 'Accessoires pour réaliser des vidéos' },
  { image: gift20, label: 'Support et éclairage', alt: 'Support de téléphone avec éclairage' },
  { image: gift21, label: 'Matériel de création', alt: 'Matériel photo et vidéo' },
  { image: gift22, label: 'Batterie externe', alt: 'Batterie externe haute capacité' }
];
const giftRows = [
  { items: gifts.slice(0, 11), duration: 58, reverse: false },
  { items: gifts.slice(11), duration: 66, reverse: true }
];

export function prizeResumeDelay(scrollLeft: number, groupWidth: number, duration: number, reverse: boolean) {
  const progress = (scrollLeft % groupWidth) / groupWidth;
  return -duration * (reverse ? (1 - progress) % 1 : progress);
}

export function PrizeShowcase({ onPlay }: { onPlay: () => void }) {
  const [paused, setPaused] = useState(false);
  const [delays, setDelays] = useState([0, 0]);
  const strips = useRef<(HTMLDivElement | null)[]>([]);
  const tracks = useRef<(HTMLDivElement | null)[]>([]);
  const pausedOffsets = useRef<number[]>([]);
  const headingId = useId();

  useLayoutEffect(() => {
    giftRows.forEach((_, index) => {
      const strip = strips.current[index];
      if (!strip) throw new Error('La rangée de cadeaux est introuvable.');
      strip.scrollLeft = paused ? pausedOffsets.current[index] : 0;
    });
  }, [paused]);

  function toggleMotion() {
    if (paused) {
      setDelays(giftRows.map((row, index) => {
        const strip = strips.current[index];
        const group = tracks.current[index]?.firstElementChild;
        if (!strip || !group) throw new Error('La rangée de cadeaux est introuvable.');
        const width = group.getBoundingClientRect().width;
        if (!width) throw new Error('La largeur de la rangée de cadeaux est invalide.');
        return prizeResumeDelay(strip.scrollLeft, width, row.duration, row.reverse);
      }));
    } else {
      pausedOffsets.current = giftRows.map((_, index) => {
        const track = tracks.current[index];
        if (!track) throw new Error('La piste de cadeaux est introuvable.');
        const transform = getComputedStyle(track).transform;
        return transform === 'none' ? 0 : Math.max(0, -new DOMMatrixReadOnly(transform).m41);
      });
    }
    setPaused(!paused);
  }

  return <section className={`prize-showcase${paused ? ' is-paused' : ''}`} aria-labelledby={headingId}>
    <div className="prize-showcase-header">
      <div>
        <span className="prize-showcase-eyebrow"><Gift size={15} aria-hidden="true" />Des défis, des surprises</span>
        <h2 id={headingId}>Jouez aux quiz, brillez et <strong>tentez de gagner des cadeaux et des surprises !</strong></h2>
        <p>Smartphones, ordinateurs, tablettes et accessoires : faites le plein d’idées pour vos prochains défis.</p>
      </div>
      <div className="prize-showcase-actions">
        <button className="prize-play" type="button" onClick={onPlay}>Explorer les quiz<ArrowUpRight size={17} aria-hidden="true" /></button>
        <button className="prize-motion-toggle" type="button" onClick={toggleMotion}>
          {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          {paused ? 'Reprendre l’animation' : 'Mettre l’animation en pause'}
        </button>
      </div>
    </div>
    <div className="prize-rows">
      {giftRows.map((row, rowIndex) => <div key={rowIndex} className={`prize-strip${row.reverse ? ' prize-strip-reverse' : ''}`}
        ref={element => { strips.current[rowIndex] = element; }}
        role="region" aria-label={`${rowIndex === 0 ? 'Première' : 'Deuxième'} série d’idées de cadeaux`} tabIndex={0}>
        <div className="prize-track" ref={element => { tracks.current[rowIndex] = element; }}
          style={{ animationDuration: `${row.duration}s`, animationDelay: `${delays[rowIndex]}s` }}>
          {[0, 1].map(copy => <ul key={copy} className="prize-group" aria-hidden={copy === 1 ? true : undefined}>
            {row.items.map(gift => <li className="prize-card" key={gift.image}>
              <img src={gift.image} alt={gift.alt} width={156} height={110} loading="lazy" decoding="async" />
              <span aria-hidden="true">{gift.label}</span>
            </li>)}
          </ul>)}
        </div>
      </div>)}
    </div>
    <p className="prize-disclaimer">Visuels d’illustration : les cadeaux éventuels dépendent des conditions des défis.</p>
  </section>;
}
