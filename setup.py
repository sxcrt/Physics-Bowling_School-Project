"""Panda3D ``build_apps`` packaging config (ADD-ON; the game itself is untouched).

Builds a Windows distributable of the *unchanged* game::

    python setup.py build_apps

The output lands in ``build/`` and ``dist/``. This only packages the game;
it does not run it on Vercel (which cannot host a Panda3D desktop app).
"""
from setuptools import setup

setup(
    name='hells-balls',
    version='1.0.0',
    options={
        'build_apps': {
            'gui_apps': {
                'Hells Balls': 'main.py',
            },
            # Only build for the machine we are running on.
            'platforms': ['win_amd64'],
            'include_patterns': [
                'assets/**',
                'textures/**',
            ],
            'exclude_patterns': [
                'tests/**',
                'docs/**',
                'web/**',
                'tools/**',
                '**/__pycache__/**',
                '**/*.pyc',
            ],
            'log_filename': 'hells_balls.log',
        },
    },
)
