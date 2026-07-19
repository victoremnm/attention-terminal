#!/usr/bin/env python3
"""
Document clustering visualization with t-SNE, PCA, and K-Means.

This script demonstrates how to visualize high-dimensional text data in 2D
using dimensionality reduction and clustering. It reproduces the workflow
described in the project notes:

1. TF-IDF vectorization of text documents (20 newsgroups).
2. K-Means clustering to assign documents into groups.
3. PCA reduction to 2 components for visualization.
4. Matplotlib scatter plot colored by cluster with optional document labels.

It also includes a side-by-side t-SNE vs PCA comparison on the Iris dataset
for reference.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
from sklearn.cluster import KMeans
from sklearn.datasets import fetch_20newsgroups, load_iris
from sklearn.decomposition import PCA, TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.manifold import TSNE

matplotlib.rc("font", family="sans-serif", weight="bold", size=10)


def plot_iris_comparison() -> Path:
    """Compare t-SNE and PCA embeddings on the Iris dataset."""
    iris = load_iris()
    X_tsne = TSNE(learning_rate=100, random_state=0).fit_transform(iris.data)
    X_pca = PCA(random_state=0).fit_transform(iris.data)

    fig, axes = plt.subplots(1, 2, figsize=(10, 5))
    axes[0].scatter(X_tsne[:, 0], X_tsne[:, 1], c=iris.target, cmap="viridis")
    axes[0].set_title("t-SNE")
    axes[0].set_xticks(())
    axes[0].set_yticks(())

    axes[1].scatter(X_pca[:, 0], X_pca[:, 1], c=iris.target, cmap="viridis")
    axes[1].set_title("PCA")
    axes[1].set_xticks(())
    axes[1].set_yticks(())

    fig.tight_layout()
    output = Path("iris_tsne_pca.png")
    fig.savefig(output, dpi=150)
    plt.close(fig)
    return output


def plot_document_clusters(
    n_clusters: int = 5,
    n_samples: int | None = None,
    label_points: bool = False,
) -> Path:
    """
    Cluster 20 newsgroups documents with K-Means and visualize with PCA.

    Args:
        n_clusters: Number of K-Means clusters.
        n_samples: Optional cap on the number of documents to plot.
        label_points: If True, annotate each point with its document index.
    """
    categories = [
        "alt.atheism",
        "talk.religion.misc",
        "comp.graphics",
        "sci.space",
    ]
    newsgroups = fetch_20newsgroups(subset="train", categories=categories)
    vectors = TfidfVectorizer(stop_words="english").fit_transform(newsgroups.data)

    # Reduce dimensionality for clustering speed and visualization stability.
    X_reduced = TruncatedSVD(n_components=50, random_state=0).fit_transform(vectors)
    clusters = KMeans(n_clusters=n_clusters, random_state=0, n_init="auto").fit_predict(
        X_reduced
    )
    X_pca = PCA(n_components=2, random_state=0).fit_transform(X_reduced)

    if n_samples is not None:
        indices = np.random.default_rng(0).choice(
            len(X_pca), size=min(n_samples, len(X_pca)), replace=False
        )
        X_pca = X_pca[indices]
        clusters = clusters[indices]
    else:
        indices = np.arange(len(X_pca))

    fig, ax = plt.subplots(figsize=(12, 8))
    scatter = ax.scatter(
        X_pca[:, 0],
        X_pca[:, 1],
        c=clusters,
        cmap="tab10",
        alpha=0.6,
        s=10,
    )
    ax.set_title(f"K-Means ({n_clusters} clusters) of 20 newsgroups documents (PCA)")
    ax.set_xticks(())
    ax.set_yticks(())
    legend = ax.legend(*scatter.legend_elements(), title="Cluster")
    ax.add_artist(legend)

    if label_points:
        for i, (x, y) in zip(indices, X_pca):
            ax.annotate(str(i), (x, y), fontsize=6, alpha=0.5)

    fig.tight_layout()
    output = Path("document_clusters.png")
    fig.savefig(output, dpi=150)
    plt.close(fig)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Visualize document clusters with t-SNE, PCA, and K-Means."
    )
    parser.add_argument(
        "--iris",
        action="store_true",
        help="Generate the Iris t-SNE vs PCA comparison plot.",
    )
    parser.add_argument(
        "--clusters",
        type=int,
        default=5,
        help="Number of K-Means clusters for the document plot.",
    )
    parser.add_argument(
        "--samples",
        type=int,
        default=None,
        help="Limit the number of documents plotted.",
    )
    parser.add_argument(
        "--labels",
        action="store_true",
        help="Annotate document points with their index.",
    )
    args = parser.parse_args()

    if args.iris:
        output = plot_iris_comparison()
        print(f"Saved Iris comparison to {output.resolve()}")

    output = plot_document_clusters(
        n_clusters=args.clusters,
        n_samples=args.samples,
        label_points=args.labels,
    )
    print(f"Saved document cluster plot to {output.resolve()}")


if __name__ == "__main__":
    main()
