<?php
/**
 * Factory flythrough — paste into the CHILD theme's functions.php (spec §13).
 *
 * Expects, inside the child theme:
 *   page-flythrough.php
 *   flythrough/site.css, flythrough/flythrough.css, flythrough/flythrough.js
 *   flythrough/poster-*.jpg / poster-*.avif
 *
 * Everything is gated on the template, so the rest of the site loads none of it.
 */

/*
 * Where manifest.json and the frame folders live. A CDN pull zone in production
 * (spec §15) — it must send Access-Control-Allow-Origin, because the manifest is
 * fetched cross-origin. Trailing slash required.
 */
if ( ! defined( 'THREESTAR_FRAMES_BASE' ) ) {
	define( 'THREESTAR_FRAMES_BASE', trailingslashit( get_stylesheet_directory_uri() ) . 'flythrough/frames/' );
}

function threestar_is_flythrough() {
	return is_page_template( 'page-flythrough.php' );
}

add_action( 'wp_enqueue_scripts', function () {
	if ( ! threestar_is_flythrough() ) {
		return;
	}
	$dir = trailingslashit( get_stylesheet_directory_uri() ) . 'flythrough/';
	$ver = '1.0.0';
	wp_enqueue_style( 'threestar-site', $dir . 'site.css', array(), $ver );
	wp_enqueue_style( 'threestar-flythrough', $dir . 'flythrough.css', array( 'threestar-site' ), $ver );
	wp_enqueue_script( 'threestar-flythrough', $dir . 'flythrough.js', array(), $ver, array( 'strategy' => 'defer', 'in_footer' => true ) );
}, 20 );

/*
 * Must run before first paint: marks JS and opts into the pinned layout unless the
 * visitor prefers reduced motion. flythrough.js removes ft-on if frames can't load.
 */
add_action( 'wp_head', function () {
	if ( ! threestar_is_flythrough() ) {
		return;
	}
	echo "<script>(function(d){var c=d.documentElement;c.className=c.className.replace('no-js','js');if(!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches))c.className+=' ft-on';})(document);</script>\n";
	echo "<link rel=\"preconnect\" href=\"" . esc_url( THREESTAR_FRAMES_BASE ) . "\" crossorigin>\n";
}, 1 );

/*
 * Optional: drop heavy theme/plugin assets on this template only. Handles vary by
 * theme — list them from the page source, then uncomment and adjust.
 */
// add_action( 'wp_enqueue_scripts', function () {
// 	if ( threestar_is_flythrough() ) {
// 		wp_dequeue_style( 'theme-style-handle' );
// 		wp_dequeue_script( 'theme-script-handle' );
// 	}
// }, 100 );
