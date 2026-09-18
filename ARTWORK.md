# Sprite generation prompts

Generated with the built-in imagegen tool, one request per asset, no retries or bitmap modifications.

## Adventurer

Use case: stylized-concept
Asset type: production 2D dungeon game character sprite sheet, PNG, 1024x1024 pixels.
Primary request: One cute tiny dungeon adventurer wearing a green hood and short green cape, with a warm tan face and small brown boots, rendered as crisp 16-bit pixel art. Warm cozy dungeon palette.
Scene/backdrop: genuinely transparent alpha background throughout every empty area. No floor, environment, or painted checkerboard.
Composition/framing: precisely 4 columns by 4 rows, 16 evenly spaced full-body sprites, each occupying its own equal 256x256 pixel cell. Cell centers at x=128,384,640,896 and y=128,384,640,896. Entire character visible in each cell with consistent generous transparent margins and identical scale. Within each cell, center the character horizontally and use the same baseline.
Frame direction order: row 1 facing DOWN toward viewer; row 2 facing LEFT in profile; row 3 facing RIGHT in profile; row 4 facing UP away from viewer. Each row has four distinct consecutive walk-cycle poses: left step, passing pose, right step, passing pose. Keep identical character identity, outfit, size and pivot in all frames.
Style: simple readable chunky pixel clusters, hard pixel edges, limited color palette, dark warm outline and minimal shading; suitable for 24-32px in-game display and an 80px lobby portrait. Character should feel like a small classic handheld RPG hero. No subpixel details, no antialiasing, no blur.
Constraints: exactly 16 sprites and exactly 4x4 equal cells. No grid lines, labels, letters, numbers, text, watermark, weapons, extra objects, drop shadows or border. True transparent PNG alpha, not a solid background.

## Monster

Use case: stylized-concept
Asset type: production 2D dungeon game character sprite sheet, PNG, 1024x1024 pixels.
Primary request: One cute small purple horned dungeon monster, a compact chubby biped with tiny cream horns, big expressive eyes, little clawed feet and short arms. Friendly mischievous personality. Crisp 16-bit pixel art, warm cozy dungeon palette.
Scene/backdrop: genuinely transparent alpha background throughout every empty area. No floor, environment, or painted checkerboard.
Composition/framing: precisely 4 columns by 4 rows, 16 evenly spaced full-body sprites, each occupying its own equal 256x256 pixel cell. Cell centers at x=128,384,640,896 and y=128,384,640,896. Entire monster visible in each cell with consistent generous transparent margins and identical scale. Within each cell, center the monster horizontally and use the same baseline.
Frame direction order: row 1 facing DOWN toward viewer; row 2 facing LEFT in profile; row 3 facing RIGHT in profile; row 4 facing UP away from viewer. Each row has four distinct consecutive walk-cycle poses: left step, passing pose, right step, passing pose. Keep identical monster identity, horns, size and pivot in all frames.
Style: simple readable chunky pixel clusters, hard pixel edges, limited color palette, dark warm outline and minimal shading; suitable for 24-32px in-game display and an 80px lobby portrait. Match a cozy classic handheld RPG world. No subpixel details, no antialiasing, no blur.
Constraints: exactly 16 sprites and exactly 4x4 equal cells. No grid lines, labels, letters, numbers, text, watermark, extra objects, drop shadows or border. True transparent PNG alpha, not a solid background.
