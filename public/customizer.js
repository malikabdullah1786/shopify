document.addEventListener('DOMContentLoaded', () => {
    // This is a basic injection. A Theme App Extension would be better.
    const productForm = document.querySelector('form[action="/cart/add"]');
    const customizerContainer = document.getElementById('customizer-container');

    if (productForm && customizerContainer) {
        productForm.prepend(customizerContainer);
    } else {
        console.warn('Shopify Product Form not found. Customizer may not appear in the right place.');
    }

    // Initialize Fabric.js canvas
    const canvas = new fabric.Canvas('c');

    const textInput = document.getElementById('text-input');
    const addTextButton = document.getElementById('add-text');
    const imageUpload = document.getElementById('image-upload');
    const addToCartButton = document.getElementById('add-to-cart');

    // Add Text to Canvas
    addTextButton.addEventListener('click', () => {
        const text = textInput.value;
        if (text) {
            const textObj = new fabric.IText(text, {
                left: 50,
                top: 100,
                fontFamily: 'arial black',
                fill: '#333',
                fontSize: 40
            });
            canvas.add(textObj);
            textInput.value = '';
        }
    });

    // Add Image to Canvas
    imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (f) => {
                fabric.Image.fromURL(f.target.result, (img) => {
                    img.scaleToWidth(150);
                    canvas.add(img);
                });
            };
            reader.readAsDataURL(file);
        }
    });

    addToCartButton.addEventListener('click', () => {
        // Dynamically find the variant ID from the product form
        const variantIdInput = productForm.querySelector('[name="id"]');
        const variantId = variantIdInput ? variantIdInput.value : null;

        if (!variantId) {
            alert('Could not find product variant ID. Cannot add to cart.');
            console.error('Variant ID input not found in product form.');
            return;
        }

        // Export the canvas to a data URL
        const designDataUrl = canvas.toDataURL({
            format: 'png',
            quality: 0.8
        });

        const properties = {
            // Include any other custom properties you need, e.g., text content
            '_custom_design': designDataUrl
        };

        const formData = {
            'items': [{
                'id': variantId,
                'quantity': 1,
                'properties': properties
            }]
        };

        fetch('/cart/add.js', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        })
        .then(response => response.json())
        .then(data => {
            console.log('Item added to cart:', data);
            alert('Customized product added to cart!');
        })
        .catch((error) => {
            console.error('Error adding to cart:', error);
            alert('There was an error adding the product to the cart.');
        });
    });
});