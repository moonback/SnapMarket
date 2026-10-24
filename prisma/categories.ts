/** Catégories initiales (administrables ensuite depuis le dashboard). */
export const DEFAULT_CATEGORIES = [
  { slug: 'mode-accessoires', name: 'Mode et accessoires', icon: 'shirt', position: 1 },
  {
    slug: 'telephones-electronique',
    name: 'Téléphones et électronique',
    icon: 'smartphone',
    position: 2,
  },
  {
    slug: 'informatique-jeux-video',
    name: 'Informatique et jeux vidéo',
    icon: 'gamepad-2',
    position: 3,
  },
  { slug: 'maison-decoration', name: 'Maison et décoration', icon: 'sofa', position: 4 },
  { slug: 'sport-loisirs', name: 'Sport et loisirs', icon: 'bike', position: 5 },
  { slug: 'beaute', name: 'Beauté', icon: 'sparkles', position: 6 },
  { slug: 'livres-culture', name: 'Livres et culture', icon: 'book-open', position: 7 },
  { slug: 'enfants', name: 'Enfants', icon: 'baby', position: 8 },
  // Les véhicules sont soumis à des règles particulières : validation manuelle des annonces.
  { slug: 'vehicules', name: 'Véhicules', icon: 'car', position: 9, requiresReview: true },
  { slug: 'autres', name: 'Autres', icon: 'package', position: 10 },
];
