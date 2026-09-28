<?php
/**
 * Template Name: Factory Flythrough
 *
 * Standalone page template for the scroll-driven flythrough (spec §13).
 * Install in a CHILD theme alongside functions-snippet.php; see README.md.
 *
 * Deliberately does not call get_header()/get_footer(): the theme header would sit
 * on top of a full-bleed canvas, and theme chrome costs frame rate. It prints a
 * minimal nav instead, but still calls wp_head()/wp_footer() so plugins work.
 * Do not build this page in Elementor/WPBakery.
 *
 * All copy lives in the arrays below. null marks a value the client has not
 * supplied; it renders as a dashed "TBC" placeholder and scripts/check-launch.sh
 * fails until none remain. Changing a figure is a text edit here — nothing to re-encode.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Beats map, in order, to the five hold spans in flythrough.js (frames 230/380/475/580/660).
$threestar_beats = array(
	array(
		'id'      => 'beat-hall',
		'kicker'  => '01 · Main hall',
		'title'   => 'The production floor',
		'body'    => 'A red steel portal frame spans one open, sealed floor.',
		'specs'   => array( 'Floor area' => null, 'Production halls' => null ),
	),
	array(
		'id'      => 'beat-bags',
		'kicker'  => '02 · Bag-making & sealing',
		'title'   => null, // machine name
		'body'    => 'Film is cut, sealed and formed into finished bags on the line.',
		'specs'   => array( 'Lines' => null, 'Output' => null, 'Cut accuracy' => null ),
	),
	array(
		'id'      => 'beat-film',
		'kicker'  => '03 · Blown-film extrusion',
		'title'   => null,
		'body'    => 'Film is blown and wound in-house, before it reaches any other line.',
		'specs'   => array( 'Layers' => null, 'Output' => null, 'Gauge' => null ),
	),
	array(
		'id'      => 'beat-print',
		'kicker'  => '04 · Printing & rewinding',
		'title'   => null,
		'body'    => 'Printed on the gantry, then rewound onto finished rolls.',
		'specs'   => array( 'Colours' => null, 'Web width' => null, 'Speed' => null ),
	),
	array(
		'id'      => 'beat-dispatch',
		'kicker'  => '05 · Dispatch',
		'title'   => 'Packed, stacked, shipped',
		'body'    => 'Finished cartons leave through the dispatch bay.',
		'specs'   => array( 'Pallet positions' => null, 'Dispatch time' => null ),
	),
);

$threestar_stats = array(
	'Established'    => null,
	'Floor area'     => null,
	'Team'           => null,
	'Export markets' => null,
);

$threestar_sectors = array(
	'food-beverage' => 'Food & Beverage',
	'personal-care' => 'Personal Care',
	'home-care'     => 'Home Care',
	'pet-care'      => 'Pet Care',
	'garments'      => 'Garments',
	'industrial'    => 'Industrial',
	'disposables'   => 'Disposables',
	'retail'        => 'Retail',
);

$threestar_products_url = home_url( '/products/' );
$threestar_tour_video   = ''; // URL of the full 2:23 cut, when supplied.

/** Prints a value, or a dashed placeholder while it is still null. */
function threestar_value( $value, $label = 'TBC' ) {
	if ( null === $value ) {
		echo '<span class="tbc" data-placeholder>' . esc_html( $label ) . '</span>';
	} else {
		echo esc_html( $value );
	}
}

$threestar_assets = trailingslashit( get_stylesheet_directory_uri() ) . 'flythrough/';
?><!doctype html>
<html <?php language_attributes(); ?> class="no-js">
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'ft-page' ); ?>>
<?php wp_body_open(); ?>

<header class="site-nav">
	<a class="site-nav__brand" href="<?php echo esc_url( home_url( '/' ) ); ?>">Threestar <span>Packaging</span></a>
	<nav class="site-nav__links" aria-label="Main">
		<a class="site-nav__about" href="#stats">About</a>
		<a href="<?php echo esc_url( $threestar_products_url ); ?>">Products</a>
		<a href="#contact">Contact</a>
	</nav>
</header>

<main>
	<section id="flythrough" class="ft" data-frames-base="<?php echo esc_url( THREESTAR_FRAMES_BASE ); ?>" aria-label="Flythrough of the factory">
		<div id="ft-stage" class="ft-stage">
			<picture>
				<source media="(max-aspect-ratio: 1/1)" type="image/avif" srcset="<?php echo esc_url( $threestar_assets . 'poster-portrait.avif' ); ?>">
				<source media="(max-aspect-ratio: 1/1)" srcset="<?php echo esc_url( $threestar_assets . 'poster-portrait.jpg' ); ?>">
				<source type="image/avif" srcset="<?php echo esc_url( $threestar_assets . 'poster-landscape.avif' ); ?>">
				<img class="ft-poster" src="<?php echo esc_url( $threestar_assets . 'poster-landscape.jpg' ); ?>" alt="Aerial view of the Threestar Packaging factory" fetchpriority="high" decoding="async">
			</picture>
			<canvas id="ft-canvas" class="ft-canvas" aria-hidden="true"></canvas>

			<div class="ft-layer">
				<div class="ft-hero">
					<p class="ft-eyebrow">Threestar Packaging</p>
					<h1 class="ft-hero__title">Fly through the factory.</h1>
					<p class="ft-hero__sub" data-draft>One continuous pass — from the gate, across the production floor, out through dispatch.</p>
				</div>

				<?php foreach ( $threestar_beats as $beat ) : ?>
				<article class="ft-beat" id="<?php echo esc_attr( $beat['id'] ); ?>">
					<p class="ft-eyebrow"><?php echo esc_html( $beat['kicker'] ); ?></p>
					<h2 class="ft-beat__title"><?php threestar_value( $beat['title'], 'Machine name TBC' ); ?></h2>
					<p class="ft-beat__body" data-draft><?php echo esc_html( $beat['body'] ); ?></p>
					<dl class="ft-specs">
						<?php foreach ( $beat['specs'] as $label => $value ) : ?>
						<div><dt><?php echo esc_html( $label ); ?></dt><dd><?php threestar_value( $value ); ?></dd></div>
						<?php endforeach; ?>
					</dl>
				</article>
				<?php endforeach; ?>
			</div>

			<p class="ft-cue" aria-hidden="true"><span>Scroll to fly through</span></p>
			<div class="ft-loader" role="progressbar" aria-label="Loading flythrough"><div class="ft-loader__bar"></div></div>
			<p class="ft-badge" aria-hidden="true">Test frames — not footage</p>
		</div>
	</section>

	<section id="stats" class="stats" aria-labelledby="stats-title">
		<h2 id="stats-title" class="visually-hidden">Threestar Packaging in numbers</h2>
		<dl class="stats__grid">
			<?php foreach ( $threestar_stats as $label => $value ) : ?>
			<div class="stats__item"><dt><?php echo esc_html( $label ); ?></dt><dd><?php threestar_value( $value ); ?></dd></div>
			<?php endforeach; ?>
		</dl>
	</section>

	<section class="handoff" aria-labelledby="handoff-title">
		<div class="wrap">
			<p class="eyebrow">Products</p>
			<h2 id="handoff-title" class="section-title">You've seen the machines.<br>Here's what they make.</h2>
			<p class="lede" data-draft>Packaging organised by the industry it serves — find your sector, then the format.</p>
			<ul class="chips">
				<?php foreach ( $threestar_sectors as $slug => $name ) : ?>
				<li><a href="<?php echo esc_url( $threestar_products_url . '#' . $slug ); ?>"><?php echo esc_html( $name ); ?></a></li>
				<?php endforeach; ?>
			</ul>
			<a class="button" href="<?php echo esc_url( $threestar_products_url ); ?>">View all products</a>
		</div>
	</section>

	<section class="tour" aria-labelledby="tour-title">
		<div class="wrap">
			<p class="eyebrow">Full walkthrough</p>
			<h2 id="tour-title" class="section-title">The complete tour</h2>
			<p class="lede">Every line, uncut — 2 min 23 s.</p>
			<?php if ( $threestar_tour_video ) : ?>
			<div class="tour__frame">
				<video class="tour__video" controls preload="none" playsinline poster="<?php echo esc_url( $threestar_assets . 'poster-landscape.jpg' ); ?>">
					<source src="<?php echo esc_url( $threestar_tour_video ); ?>" type="video/mp4">
				</video>
			</div>
			<?php else : ?>
			<p class="note tbc" data-placeholder>Video file pending from the client (full 2:23 cut).</p>
			<?php endif; ?>
		</div>
	</section>
</main>

<footer id="contact" class="site-footer">
	<div class="wrap site-footer__inner">
		<p class="site-footer__brand">Threestar Packaging</p>
		<p class="tbc" data-placeholder>Address, phone and email TBC</p>
		<p class="site-footer__small">© <?php echo esc_html( gmdate( 'Y' ) ); ?> Threestar Packaging</p>
	</div>
</footer>

<?php wp_footer(); ?>
</body>
</html>
