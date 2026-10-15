"""The project's surface shading: one soft directional light, baked per pixel.

Why a local shader: Ursina 8.3 renders entities with an *unlit* shader by
default, so a lathe body like a pin comes out flat, and its
``basic_lighting_shader`` shades by world normal with no colour control.
``lit_with_shadows_shader`` follows the scene's first DirectionalLight and a
shadow map, but a single 1024 map stretched over an 18 m lane is far too
coarse to be readable.

This shader is a deliberately simple stand-in: one warm key direction plus a
cool fill, evaluated per pixel from the interpolated world normal, with the
key colour, fill colour, direction and the shading floor/gain all supplied as
shader inputs from :mod:`config`. Flat surfaces (lane, walls) stay even, round
bodies (pins, ball) read as round, and the whole hall keeps one light
direction.
"""
from ursina import color
from ursina.shader import Shader
from ursina.vec3 import Vec3

import config

soft_lighting_shader = Shader(
    name='soft_lighting_shader', language=Shader.GLSL,
    vertex='''
    #version 140
    uniform mat4 p3d_ModelViewProjectionMatrix;
    uniform mat4 p3d_ModelMatrix;

    in vec4 p3d_Vertex;
    in vec3 p3d_Normal;
    in vec2 p3d_MultiTexCoord0;

    out vec2 texcoord;
    out vec3 world_normal;

    void main() {
        gl_Position = p3d_ModelViewProjectionMatrix * p3d_Vertex;
        texcoord = p3d_MultiTexCoord0;
        world_normal = normalize(mat3(p3d_ModelMatrix) * p3d_Normal);
    }
    ''',
    fragment='''
    #version 140
    uniform sampler2D p3d_Texture0;
    uniform vec4 p3d_ColorScale;

    uniform vec3 key_direction;
    uniform vec3 key_color;
    uniform vec3 fill_color;
    uniform float shade_floor;
    uniform float shade_gain;

    in vec2 texcoord;
    in vec3 world_normal;
    out vec4 fragColor;

    void main() {
        vec3 normal = normalize(world_normal);
        float direct = max(dot(normal, normalize(key_direction)), 0.0);
        vec3 tint = mix(fill_color, key_color, direct);
        float shade = shade_floor + shade_gain * direct;
        vec4 base = texture(p3d_Texture0, texcoord) * p3d_ColorScale;
        fragColor = vec4(base.rgb * tint * shade, base.a);
    }
    ''',
    default_input={
        # Light comes from above and slightly behind the player, which is what
        # an alley rig looks like and keeps the near face of a pin bright.
        'key_direction': Vec3(-0.25, 0.85, -0.50),
        'key_color': color.rgb32(*config.KEY_LIGHT_COLOR),
        'fill_color': color.rgb32(*config.FILL_LIGHT_COLOR),
        'shade_floor': config.SHADE_FLOOR,
        'shade_gain': config.SHADE_GAIN,
    },
)
