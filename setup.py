from setuptools import setup, find_packages

setup(
    name="tradeanim",
    version="0.2.0",
    description="Manim-like animation library for professional trading chart videos",
    author="tradeanim",
    packages=find_packages(),
    python_requires=">=3.9",
    install_requires=[
        "matplotlib>=3.7",
        "numpy>=1.24",
        "pandas>=2.0",
    ],
    extras_require={
        "dev": ["pytest"],
    },
)
